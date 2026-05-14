"""
Regression tests for hubspot-sync/lambda_function.py
Tests OAuth flow, sync push/pull, token refresh, dedup, and field mapping.
"""

import os
import sys
import json
import time
import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock, call

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'hubspot-sync'))

from test_helpers import make_event, make_authed_event, assert_status, parse_body, ADMIN_USER, REGULAR_USER


@pytest.fixture
def mock_deps():
    mock_cur = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cur
    mock_cur.fetchone.return_value = None
    mock_cur.fetchall.return_value = []

    patches = {
        'get_db_connection': patch('lambda_function.get_db_connection', return_value=mock_conn),
        'require_auth': patch('lambda_function.require_auth'),
        'requests': patch('lambda_function.requests'),
    }
    started = {k: p.start() for k, p in patches.items()}
    yield started, mock_conn, mock_cur
    for p in patches.values():
        p.stop()


@pytest.fixture
def hubspot_module():
    with patch.dict(os.environ, {
        'DATABASE_URL': 'postgresql://fake',
        'JWT_SECRET': 'test',
        'HUBSPOT_PRIVATE_TOKEN': 'test-private-token',
        'HUBSPOT_WEBHOOK_SECRET': 'test-webhook-secret',
    }):
        with patch('psycopg2.connect') as mock_connect:
            mock_cur = MagicMock()
            mock_cur.fetchone.return_value = None
            mock_cur.fetchall.return_value = []
            mock_conn = MagicMock()
            mock_conn.cursor.return_value = mock_cur
            mock_connect.return_value = mock_conn

            import importlib
            if 'lambda_function' in sys.modules:
                del sys.modules['lambda_function']
            hubspot_dir = os.path.join(os.path.dirname(__file__), '..', 'hubspot-sync')
            sys.path.insert(0, hubspot_dir)
            try:
                import lambda_function
                importlib.reload(lambda_function)
                yield lambda_function
            finally:
                sys.path.remove(hubspot_dir)
                if 'lambda_function' in sys.modules:
                    del sys.modules['lambda_function']


class TestOptionsHandler:
    def test_options_returns_200(self, hubspot_module, mock_deps):
        event = make_event(method='OPTIONS', path='/hubspot/status')
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 200)


class TestAuthRequired:
    def test_unauthenticated_returns_401(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (None, {
            'statusCode': 401,
            'headers': {},
            'body': json.dumps({'error': 'Unauthorized'})
        })

        event = make_event(method='GET', path='/hubspot/status')
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 401)

    def test_callback_returns_private_app_message(self, hubspot_module, mock_deps):
        """OAuth callback should return private app message."""
        started, mock_conn, mock_cur = mock_deps

        event = make_event(method='GET', path='/hubspot/callback',
                           query_params={'code': 'test-auth-code'})
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 200)
        body = parse_body(response)
        assert body['status'] == 'private_app'

        # require_auth should NOT have been called
        started['require_auth'].assert_not_called()


class TestPrivateAppAuth:
    def test_connect_returns_private_app_message(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='POST', path='/hubspot/connect')
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 200)
        body = parse_body(response)
        assert body['status'] == 'private_app'
        assert body['connected'] is True
        assert 'Private App' in body['message']

    def test_callback_returns_private_app_message(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps

        event = make_event(method='GET', path='/hubspot/callback',
                           query_params={'code': 'auth-code-123'})
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 200)
        body = parse_body(response)
        assert body['status'] == 'private_app'

    def test_get_access_token_returns_env_var(self, hubspot_module):
        result = hubspot_module._get_access_token()
        assert result == 'test-private-token'

    def test_get_access_token_returns_none_when_empty(self, hubspot_module):
        with patch.object(hubspot_module, 'HUBSPOT_PRIVATE_TOKEN', ''):
            result = hubspot_module._get_access_token()
            assert result is None


class TestSyncPush:
    def test_push_requires_client_id(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        with patch.object(hubspot_module, '_get_access_token', return_value='test-token'):
            event = make_event(method='POST', path='/hubspot/sync/push', body={'client_id': ''})
            response = hubspot_module.lambda_handler(event, None)
            assert_status(response, 400)

    def test_push_client_not_found_returns_404(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)
        mock_cur.fetchone.return_value = None

        with patch.object(hubspot_module, '_get_access_token', return_value='test-token'):
            event = make_event(method='POST', path='/hubspot/sync/push',
                               body={'client_id': 'nonexistent-uuid'})
            response = hubspot_module.lambda_handler(event, None)
            assert_status(response, 404)

    def test_push_maps_fields_correctly(self, hubspot_module, mock_deps):
        """Verify correct field mapping when pushing to HubSpot."""
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        # Client record matching new column order:
        # id, company_name, website_url, industry, description,
        # future_plans, status, source, nda_signed, nda_signed_at,
        # intellagentic_lead, pain_points_json, contacts_json,
        # addresses_json, s3_folder, hubspot_company_id,
        # hubspot_contact_id, account_id, encryption_key
        client_row = (
            'uuid-123', 'Acme Corp', 'https://acme.com', 'Technology', 'AI startup',
            'Expand to EU', 'active', 'manual', True, None,
            False, json.dumps(['Slow onboarding']),
            json.dumps([{'name': 'John Doe', 'email': 'john@acme.com', 'phone': '+1234567890', 'title': 'CEO'}]),
            json.dumps([{'address1': '123 Main', 'city': 'London', 'country': 'UK'}]),
            'acme-folder', None,
            None, None, None
        )
        mock_cur.fetchone.side_effect = [client_row]

        with patch.object(hubspot_module, '_get_access_token', return_value='test-token'), \
             patch.object(hubspot_module, '_push_company', return_value='hs-company-99') as mock_push_co, \
             patch.object(hubspot_module, '_push_contacts', return_value='hs-contact-55') as mock_push_ct, \
             patch.object(hubspot_module, '_get_config', return_value=None), \
             patch.object(hubspot_module, '_push_enrichment_note'):

            event = make_event(method='POST', path='/hubspot/sync/push',
                               body={'client_id': 'uuid-123'})
            response = hubspot_module.lambda_handler(event, None)
            assert_status(response, 200)
            body = parse_body(response)
            assert body['hubspot_company_id'] == 'hs-company-99'
            assert body['hubspot_contact_id'] == 'hs-contact-55'

            # Verify push_company was called with correct record
            mock_push_co.assert_called_once()
            call_record = mock_push_co.call_args[0][1]
            assert call_record['company_name'] == 'Acme Corp'
            assert call_record['website_url'] == 'https://acme.com'
            assert call_record['industry'] == 'Technology'
            assert call_record['description'] == 'AI startup'
            assert call_record['future_plans'] == 'Expand to EU'
            assert call_record['nda_signed'] is True

            # Verify push_contacts was called (not push_contact)
            mock_push_ct.assert_called_once()


class TestSyncPull:
    def test_pull_requires_hubspot_company_id(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        with patch.object(hubspot_module, '_get_access_token', return_value='test-token'):
            event = make_event(method='POST', path='/hubspot/sync/pull',
                               body={'hubspot_company_id': ''})
            response = hubspot_module.lambda_handler(event, None)
            assert_status(response, 400)

    def test_pull_creates_new_client(self, hubspot_module, mock_deps):
        """Verify that pulling a new company creates a client record."""
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)
        mock_cur.fetchone.return_value = None  # No existing client

        with patch.object(hubspot_module, '_get_access_token', return_value='test-token'), \
             patch.object(hubspot_module, '_hubspot_api') as mock_api:

            mock_api.return_value = {
                'id': 'hs-123',
                'properties': {
                    'name': 'New Co',
                    'website': 'https://newco.com',
                    'industry': 'Finance',
                    'description': 'Fintech startup',
                    'xo_record_type': 'client',
                    'xo_client_id': '',
                    'xo_status': 'active',
                    'xo_nda_signed': 'true',
                    'xo_intellagentic_lead': 'false',
                },
            }

            event = make_event(method='POST', path='/hubspot/sync/pull',
                               body={'hubspot_company_id': 'hs-123'})
            response = hubspot_module.lambda_handler(event, None)
            assert_status(response, 200)
            body = parse_body(response)
            assert body['status'] == 'pulled'
            assert body['record_type'] == 'client'


class TestDedupLogic:
    def test_normalize_domain(self, hubspot_module):
        n = hubspot_module._normalize_domain
        assert n('https://www.Example.com/') == 'example.com'
        assert n('http://example.com') == 'example.com'
        assert n('HTTP://WWW.EXAMPLE.COM/path/page') == 'example.com'
        assert n('www.example.com') == 'example.com'
        assert n('example.com/') == 'example.com'
        assert n('https://elkor.uk/') == 'elkor.uk'
        assert n('www.Intellagentic.io') == 'intellagentic.io'
        assert n('') == ''
        assert n(None) == ''

    def test_dedup_matches_on_domain(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps

        with patch.object(hubspot_module, '_hubspot_api') as mock_api:
            mock_api.return_value = {
                'results': [{'id': 'hs-existing-1', 'properties': {'name': 'Match Co', 'domain': 'match.com', 'website': ''}}]
            }
            result = hubspot_module._find_hubspot_company('test-token', domain='https://www.Match.com/')
            assert result is not None
            assert result['id'] == 'hs-existing-1'

    def test_dedup_matches_website_with_different_format(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps

        with patch.object(hubspot_module, '_hubspot_api') as mock_api:
            # First call (domain property search) returns no match, second (website) returns match
            mock_api.side_effect = [
                {'results': []},
                {'results': [{'id': 'hs-web-1', 'properties': {'name': 'Web Co', 'domain': '', 'website': 'https://WWW.webco.com/about'}}]},
            ]
            result = hubspot_module._find_hubspot_company('test-token', domain='http://webco.com')
            assert result is not None
            assert result['id'] == 'hs-web-1'

    def test_dedup_falls_back_to_name(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps

        with patch.object(hubspot_module, '_hubspot_api', return_value={'results': []}):
            # All domain/website searches return empty, then name search
            def api_side_effect(*args, **kwargs):
                body = kwargs.get('json_body') or (args[3] if len(args) > 3 else None)
                if body and 'filterGroups' in body:
                    filters = body['filterGroups'][0]['filters']
                    if filters[0]['propertyName'] == 'name':
                        return {'results': [{'id': 'hs-name-match', 'properties': {'name': 'Acme Corp', 'domain': '', 'website': ''}}]}
                return {'results': []}

            with patch.object(hubspot_module, '_hubspot_api', side_effect=api_side_effect):
                result = hubspot_module._find_hubspot_company('test-token', domain='nope.com', company_name='Acme Corp')
                assert result is not None
                assert result['id'] == 'hs-name-match'

    def test_dedup_returns_none_when_no_match(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps

        with patch.object(hubspot_module, '_hubspot_api', return_value={'results': []}):
            result = hubspot_module._find_hubspot_company('test-token', domain='none.com', company_name='Unknown')
            assert result is None


class TestPartnerAssociation:
    def test_partner_client_association_mapping(self, hubspot_module):
        """Verify _build_company_properties sets xo_record_type correctly."""
        record = {
            'id': 'uuid-1',
            'company_name': 'Test Partner',
            'website_url': 'testpartner.com',
            'industry': 'Consulting',
            'description': 'A partner org',
            'nda_signed': True,
            'status': 'active',
            'source': 'manual',
            'intellagentic_lead': True,
        }
        props = hubspot_module._build_company_properties(record, 'partner')
        assert props['xo_record_type'] == 'partner'
        assert props['name'] == 'Test Partner'
        assert props['website'] == 'testpartner.com'
        assert props['xo_industry'] == 'Consulting'
        assert props['description'] == 'A partner org'
        assert props['xo_nda_signed'] == 'true'
        assert props['xo_status'] == 'active'
        assert props['xo_source'] == 'manual'
        assert props['xo_intellagentic_lead'] == 'true'
        assert props['xo_client_id'] == 'uuid-1'

        props_client = hubspot_module._build_company_properties(record, 'client')
        assert props_client['xo_record_type'] == 'client'


class TestFieldMapping:
    def test_contact_properties_from_combined_name(self, hubspot_module):
        contact = {
            'name': 'Jane Smith',
            'email': 'jane@test.com',
            'phone': '+44123456',
            'title': 'CTO',
        }
        props = hubspot_module._build_contact_properties_from_obj(contact)
        assert props['firstname'] == 'Jane'
        assert props['lastname'] == 'Smith'
        assert props['email'] == 'jane@test.com'
        assert props['phone'] == '+44123456'
        assert props['jobtitle'] == 'CTO'

    def test_contact_properties_from_separate_names(self, hubspot_module):
        contact = {
            'firstName': 'Edem',
            'lastName': 'Brampah',
            'email': 'edem@test.com',
            'phone': '07443 238369',
            'title': 'Fire Safety Engineer',
            'linkedin': 'https://linkedin.com/in/edem',
        }
        props = hubspot_module._build_contact_properties_from_obj(contact)
        assert props['firstname'] == 'Edem'
        assert props['lastname'] == 'Brampah'
        assert props['phone'] == '07443 238369'
        assert props['jobtitle'] == 'Fire Safety Engineer'
        assert props['linkedinbio'] == 'https://linkedin.com/in/edem'

    def test_contact_firstName_only(self, hubspot_module):
        contact = {'firstName': 'Edem', 'email': 'e@test.com'}
        props = hubspot_module._build_contact_properties_from_obj(contact)
        assert props['firstname'] == 'Edem'
        assert 'lastname' not in props

    def test_contact_combined_name_fallback(self, hubspot_module):
        contact = {'name': 'Madonna', 'email': 'm@test.com'}
        props = hubspot_module._build_contact_properties_from_obj(contact)
        assert props['firstname'] == 'Madonna'
        assert props.get('lastname', '') == ''

    def test_honorific_not_pushed_as_jobtitle(self, hubspot_module):
        for honorific in ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'mr.', 'DR.']:
            contact = {'firstName': 'Test', 'title': honorific, 'email': 't@t.com'}
            props = hubspot_module._build_contact_properties_from_obj(contact)
            assert 'jobtitle' not in props, f'{honorific} should not be pushed as jobtitle'

    def test_real_title_pushed_as_jobtitle(self, hubspot_module):
        contact = {'firstName': 'Test', 'title': 'Chief Technology Officer', 'email': 't@t.com'}
        props = hubspot_module._build_contact_properties_from_obj(contact)
        assert props['jobtitle'] == 'Chief Technology Officer'

    def test_linkedin_mapped(self, hubspot_module):
        contact = {'name': 'Test', 'linkedin': 'https://linkedin.com/in/test'}
        props = hubspot_module._build_contact_properties_from_obj(contact)
        assert props['linkedinbio'] == 'https://linkedin.com/in/test'

    def test_multiple_contacts_push(self, hubspot_module, mock_deps):
        """Verify _push_contacts handles multiple contacts from contacts_json."""
        started, mock_conn, mock_cur = mock_deps
        contacts = [
            {'name': 'Primary Contact', 'email': 'primary@test.com', 'phone': '+1111', 'title': 'CEO'},
            {'name': 'Secondary Contact', 'email': 'secondary@test.com', 'phone': '+2222', 'title': 'CTO'},
        ]
        record = {
            'contacts_json': json.dumps(contacts),
            'hubspot_contact_id': None,
        }

        with patch.object(hubspot_module, '_push_single_contact', side_effect=['hs-c1', 'hs-c2']) as mock_push:
            result = hubspot_module._push_contacts('tok', record, 'hs-co-1')
            assert result == 'hs-c1'  # primary contact ID returned
            assert mock_push.call_count == 2

    def test_address_mapping_from_json(self, hubspot_module):
        record = {
            'id': 'uuid-addr',
            'company_name': 'Addr Co',
            'addresses_json': json.dumps([{
                'address1': '123 Main St',
                'address2': 'Suite 4',
                'city': 'London',
                'state': 'England',
                'postalCode': 'EC1A 1BB',
                'country': 'UK',
            }]),
        }
        props = hubspot_module._build_company_properties(record, 'client')
        # Standard HubSpot address fields from first address
        assert props['address'] == '123 Main St'
        assert props['address2'] == 'Suite 4'
        assert props['city'] == 'London'
        assert props['zip'] == 'EC1A 1BB'
        assert props['country'] == 'UK'
        # Full JSON also stored as custom property
        assert 'xo_addresses_json' in props
        parsed = json.loads(props['xo_addresses_json'])
        assert parsed[0]['address1'] == '123 Main St'

    def test_pain_points_json_mapping(self, hubspot_module):
        record = {
            'id': 'uuid-pp',
            'company_name': 'Pain Co',
            'pain_points_json': json.dumps(['Slow onboarding', 'Manual data entry']),
        }
        props = hubspot_module._build_company_properties(record, 'client')
        assert 'xo_pain_points_json' in props
        parsed = json.loads(props['xo_pain_points_json'])
        assert len(parsed) == 2
        assert 'Slow onboarding' in parsed

    def test_future_plans_mapping(self, hubspot_module):
        record = {
            'id': 'uuid-fp',
            'company_name': 'Future Co',
            'future_plans': 'Expand to APAC region',
        }
        props = hubspot_module._build_company_properties(record, 'client')
        assert props['xo_future_plans'] == 'Expand to APAC region'

    def test_website_maps_to_website_not_domain(self, hubspot_module):
        record = {
            'id': 'uuid-web',
            'company_name': 'Web Co',
            'website_url': 'https://webco.com',
        }
        props = hubspot_module._build_company_properties(record, 'client')
        assert props['website'] == 'https://webco.com'
        assert 'domain' not in props

    def test_mapping_endpoint_returns_config(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='GET', path='/hubspot/mapping')
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 200)
        body = parse_body(response)
        assert 'client_to_company' in body
        assert 'custom_properties' in body
        assert 'associations' in body
        assert 'dedup_strategy' in body
        # Verify new fields are present
        assert 'future_plans' in body['client_to_company']
        assert 'pain_points_json' in body['client_to_company']
        assert 'contacts_json' in body['client_to_company']
        assert 'xo_future_plans' in body['custom_properties']
        assert 'xo_pain_points_json' in body['custom_properties']
        assert 'xo_addresses_json' in body['custom_properties']
        # Verify removed fields are NOT present
        assert 'contact_name' not in body['client_to_company']
        assert 'contact_email' not in body['client_to_company']


class TestStatus:
    def test_status_disconnected_when_no_token(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        with patch.object(hubspot_module, 'HUBSPOT_PRIVATE_TOKEN', ''):
            event = make_event(method='GET', path='/hubspot/status')
            response = hubspot_module.lambda_handler(event, None)
            assert_status(response, 200)
            body = parse_body(response)
            assert body['connected'] is False

    def test_status_connected_with_valid_token(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)
        mock_cur.fetchone.return_value = None

        with patch.object(hubspot_module, '_hubspot_api', return_value={'results': []}):
            event = make_event(method='GET', path='/hubspot/status')
            response = hubspot_module.lambda_handler(event, None)
            assert_status(response, 200)
            body = parse_body(response)
            assert body['connected'] is True
            assert body['auth_type'] == 'private_app'


class TestRouting:
    def test_unknown_route_returns_404(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='GET', path='/hubspot/nonexistent')
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 404)

    def test_sync_push_route(self, hubspot_module, mock_deps):
        """Verify /hubspot/sync/push routes to push handler, not full sync."""
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        with patch.object(hubspot_module, '_get_access_token', return_value='tok'):
            event = make_event(method='POST', path='/hubspot/sync/push', body={'client_id': ''})
            response = hubspot_module.lambda_handler(event, None)
            # Should get 400 (missing client_id) not a full sync response
            assert_status(response, 400)
            body = parse_body(response)
            assert 'client_id' in body['error']

    def test_conflicts_route(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)
        mock_cur.fetchall.return_value = []

        event = make_event(method='GET', path='/hubspot/conflicts')
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 200)

    def test_resolve_route(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        event = make_event(method='POST', path='/hubspot/conflicts/resolve', body={'record_id': '', 'winner': 'xo'})
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 400)  # missing record_id


class TestSyncDirection:
    """Test timestamp-based conflict resolution logic."""

    def test_first_sync_returns_first_sync(self, hubspot_module):
        result = hubspot_module._determine_sync_direction(
            xo_updated_at=datetime(2026, 3, 28, 10, 0, tzinfo=timezone.utc),
            hs_lastmodified=datetime(2026, 3, 28, 9, 0, tzinfo=timezone.utc),
            last_sync=None
        )
        assert result == 'first_sync'

    def test_xo_newer_returns_push(self, hubspot_module):
        last_sync = datetime(2026, 3, 28, 8, 0, tzinfo=timezone.utc)
        result = hubspot_module._determine_sync_direction(
            xo_updated_at=datetime(2026, 3, 28, 10, 0, tzinfo=timezone.utc),
            hs_lastmodified=datetime(2026, 3, 28, 7, 0, tzinfo=timezone.utc),
            last_sync=last_sync
        )
        assert result == 'push'

    def test_hs_newer_returns_pull(self, hubspot_module):
        last_sync = datetime(2026, 3, 28, 8, 0, tzinfo=timezone.utc)
        result = hubspot_module._determine_sync_direction(
            xo_updated_at=datetime(2026, 3, 28, 7, 0, tzinfo=timezone.utc),
            hs_lastmodified=datetime(2026, 3, 28, 10, 0, tzinfo=timezone.utc),
            last_sync=last_sync
        )
        assert result == 'pull'

    def test_both_changed_returns_conflict(self, hubspot_module):
        last_sync = datetime(2026, 3, 28, 8, 0, tzinfo=timezone.utc)
        result = hubspot_module._determine_sync_direction(
            xo_updated_at=datetime(2026, 3, 28, 10, 0, tzinfo=timezone.utc),
            hs_lastmodified=datetime(2026, 3, 28, 9, 0, tzinfo=timezone.utc),
            last_sync=last_sync
        )
        assert result == 'conflict'

    def test_neither_changed_returns_none(self, hubspot_module):
        last_sync = datetime(2026, 3, 28, 10, 0, tzinfo=timezone.utc)
        result = hubspot_module._determine_sync_direction(
            xo_updated_at=datetime(2026, 3, 28, 7, 0, tzinfo=timezone.utc),
            hs_lastmodified=datetime(2026, 3, 28, 7, 0, tzinfo=timezone.utc),
            last_sync=last_sync
        )
        assert result == 'none'


class TestConflictResolution:

    def test_first_sync_hubspot_wins(self, hubspot_module, mock_deps):
        """First sync (hubspot_last_sync is NULL) — HubSpot values overwrite XO."""
        started, mock_conn, mock_cur = mock_deps

        # Simulate: xo_id exists, hubspot_last_sync=NULL, updated_at exists
        mock_cur.fetchone.return_value = (None, datetime(2026, 3, 28, 5, 0, tzinfo=timezone.utc))

        hs_props = {
            'name': 'HubSpot Name',
            'website': 'https://hubspot.com',
            'industry': 'Tech',
            'description': 'From HubSpot',
            'hs_lastmodifieddate': '2026-03-28T10:00:00.000Z',
            'xo_status': 'active',
        }

        with patch.object(hubspot_module, '_log_sync') as mock_log, \
             patch.object(hubspot_module, '_apply_hs_to_xo_update', return_value=['company_name', 'website_url']) as mock_apply:
            action, conflict = hubspot_module._pull_client_record(mock_cur, mock_conn, 'hs-1', 'xo-uuid-1', hs_props)
            assert action == 'updated'
            assert conflict is None
            mock_apply.assert_called_once()
            mock_log.assert_called_once()
            # _log_sync(conn, record_type, record_id, hubspot_id, direction, ...)
            assert mock_log.call_args[0][4] == 'pull'

    def test_ongoing_sync_xo_wins_when_newer(self, hubspot_module, mock_deps):
        """XO updated after last sync, HubSpot not — XO wins, no pull applied."""
        started, mock_conn, mock_cur = mock_deps

        last_sync = datetime(2026, 3, 28, 8, 0, tzinfo=timezone.utc)
        xo_updated = datetime(2026, 3, 28, 10, 0, tzinfo=timezone.utc)
        mock_cur.fetchone.return_value = (last_sync, xo_updated)

        hs_props = {
            'name': 'Old HubSpot',
            'hs_lastmodifieddate': '2026-03-28T07:00:00.000Z',
        }

        with patch.object(hubspot_module, '_log_sync') as mock_log:
            action, conflict = hubspot_module._pull_client_record(mock_cur, mock_conn, 'hs-2', 'xo-uuid-2', hs_props)
            assert action is None  # No change applied
            assert conflict is None
            mock_log.assert_called_once()
            assert mock_log.call_args[0][4] == 'push'  # direction param index 4

    def test_ongoing_sync_hs_wins_when_newer(self, hubspot_module, mock_deps):
        """HubSpot updated after last sync, XO not — HubSpot wins."""
        started, mock_conn, mock_cur = mock_deps

        last_sync = datetime(2026, 3, 28, 8, 0, tzinfo=timezone.utc)
        xo_updated = datetime(2026, 3, 28, 7, 0, tzinfo=timezone.utc)
        mock_cur.fetchone.return_value = (last_sync, xo_updated)

        hs_props = {
            'name': 'Newer HubSpot',
            'website': 'https://new.com',
            'hs_lastmodifieddate': '2026-03-28T10:00:00.000Z',
            'industry': '',
            'description': '',
        }

        with patch.object(hubspot_module, '_log_sync') as mock_log, \
             patch.object(hubspot_module, '_apply_hs_to_xo_update', return_value=['company_name']) as mock_apply:
            action, conflict = hubspot_module._pull_client_record(mock_cur, mock_conn, 'hs-3', 'xo-uuid-3', hs_props)
            assert action == 'updated'
            assert conflict is None
            mock_apply.assert_called_once()

    def test_true_conflict_not_overwritten(self, hubspot_module, mock_deps):
        """Both sides changed — conflict logged, neither side overwritten."""
        started, mock_conn, mock_cur = mock_deps

        last_sync = datetime(2026, 3, 28, 8, 0, tzinfo=timezone.utc)
        xo_updated = datetime(2026, 3, 28, 10, 0, tzinfo=timezone.utc)

        # First call: (last_sync, updated_at), Second call: XO record for comparison
        mock_cur.fetchone.side_effect = [
            (last_sync, xo_updated),
            ('XO Company', 'https://xo.com', 'XO Industry', 'XO Desc', 'XO Plans',
             'active', 'manual', '', '', None),
        ]

        hs_props = {
            'name': 'HS Company',
            'website': 'https://hs.com',
            'industry': 'HS Industry',
            'description': 'HS Desc',
            'hs_lastmodifieddate': '2026-03-28T09:00:00.000Z',
            'xo_future_plans': '',
            'xo_status': 'active',
            'xo_source': 'manual',
            'xo_pain_points_json': '',
            'xo_addresses_json': '',
        }

        with patch.object(hubspot_module, '_log_sync') as mock_log, \
             patch.object(hubspot_module, 'unwrap_client_key', return_value=None):
            action, conflict = hubspot_module._pull_client_record(mock_cur, mock_conn, 'hs-4', 'xo-uuid-4', hs_props)

            # Should return a conflict
            assert action == 'conflict'
            assert conflict is not None
            assert conflict['record_type'] == 'client'
            assert conflict['record_id'] == 'xo-uuid-4'
            assert len(conflict['conflicting_fields']) > 0
            assert 'company_name' in conflict['conflicting_fields']

            # _log_sync called with direction='conflict' (param index 4)
            mock_log.assert_called_once()
            assert mock_log.call_args[0][4] == 'conflict'

    def test_resolve_conflict_endpoint_requires_params(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)

        # Missing winner
        event = make_event(method='POST', path='/hubspot/conflicts/resolve',
                           body={'record_id': 'uuid-1'})
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 400)

        # Invalid winner
        event = make_event(method='POST', path='/hubspot/conflicts/resolve',
                           body={'record_id': 'uuid-1', 'winner': 'neither'})
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 400)

    def test_resolve_conflict_not_found(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)
        mock_cur.fetchone.return_value = None

        event = make_event(method='POST', path='/hubspot/conflicts/resolve',
                           body={'record_id': 'no-such-id', 'winner': 'xo'})
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 404)

    def test_get_conflicts_empty(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        started['require_auth'].return_value = (ADMIN_USER, None)
        mock_cur.fetchall.return_value = []

        event = make_event(method='GET', path='/hubspot/conflicts')
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 200)
        body = parse_body(response)
        assert body['conflicts'] == []


class TestSyncLogging:

    def test_log_sync_writes_entry(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps

        hubspot_module._log_sync(
            mock_conn, 'client', 'uuid-1', 'hs-1', 'pull',
            fields_updated=['company_name', 'website_url'],
            details='Test log entry'
        )

        mock_cur.execute.assert_called_once()
        call_args = mock_cur.execute.call_args
        assert 'hubspot_sync_log' in call_args[0][0]
        params = call_args[0][1]
        assert params[0] == 'client'
        assert params[1] == 'uuid-1'
        assert params[3] == 'pull'
        assert 'company_name' in params[4]  # fields_updated JSON

    def test_detect_field_conflicts(self, hubspot_module):
        xo_record = {
            'company_name': 'XO Name',
            'website_url': 'https://same.com',
            'industry': 'Tech',
            'description': '',
            'future_plans': '',
            'status': 'active',
            'source': '',
            'pain_points_json': '',
            'addresses_json': '',
        }
        hs_props = {
            'name': 'HS Name',
            'website': 'https://same.com',
            'xo_industry': 'Tech',
            'description': 'New desc',
            'xo_future_plans': '',
            'xo_status': 'active',
            'xo_source': '',
            'xo_pain_points_json': '',
            'xo_addresses_json': '',
        }
        conflicts = hubspot_module._detect_field_conflicts(xo_record, hs_props)
        assert 'company_name' in conflicts
        assert 'description' in conflicts
        assert 'website_url' not in conflicts  # same value
        assert 'industry' not in conflicts  # same value


class TestWebhook:
    def test_webhook_rejects_missing_secret(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        event = make_event(method='POST', path='/hubspot/webhook', query_params={})
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 401)

    def test_webhook_rejects_wrong_secret(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        event = make_event(method='POST', path='/hubspot/webhook',
                           query_params={'secret': 'wrong-secret'})
        response = hubspot_module.lambda_handler(event, None)
        assert_status(response, 401)

    def test_webhook_accepts_correct_secret(self, hubspot_module, mock_deps):
        started, mock_conn, mock_cur = mock_deps
        mock_cur.fetchall.return_value = []

        with patch.object(hubspot_module, '_ensure_custom_properties'), \
             patch.object(hubspot_module, '_pull_companies', return_value=(1, 2, [])) as mock_pull, \
             patch.object(hubspot_module, '_set_config'):
            event = make_event(method='POST', path='/hubspot/webhook',
                               query_params={'secret': 'test-webhook-secret'})
            response = hubspot_module.lambda_handler(event, None)
            assert_status(response, 200)
            body = parse_body(response)
            assert body['mode'] == 'pull_only'
            assert body['pulled']['clients_created'] == 1
            assert body['pulled']['clients_updated'] == 2
            # Should NOT have called require_auth
            started['require_auth'].assert_not_called()

    def test_webhook_does_pull_only(self, hubspot_module, mock_deps):
        """Webhook should only pull, not push."""
        started, mock_conn, mock_cur = mock_deps

        with patch.object(hubspot_module, '_ensure_custom_properties'), \
             patch.object(hubspot_module, '_pull_companies', return_value=(0, 0, [])) as mock_pull, \
             patch.object(hubspot_module, '_push_company') as mock_push, \
             patch.object(hubspot_module, '_set_config'):
            event = make_event(method='POST', path='/hubspot/webhook',
                               query_params={'secret': 'test-webhook-secret'})
            response = hubspot_module.lambda_handler(event, None)
            assert_status(response, 200)
            mock_push.assert_not_called()


# ──────────────────────────────────────────────
# Stage 0 integrations migration — HubSpot regression gate
# Confirms HubSpot continues to read/write NULL-account_id rows after the
# system_config schema change. Required by Stage 0 validation gates.
# ──────────────────────────────────────────────

class TestStage0MigrationRegression:
    def test_set_config_writes_null_account_id(self, hubspot_module, mock_deps):
        """HubSpot _set_config must write account_id = NULL (intentional asymmetry,
        do not 'fix' by backfilling to an Intellagentic account_id)."""
        started, mock_conn, mock_cur = mock_deps
        hubspot_module._set_config(mock_conn, 'hubspot_access_token', 'tok')

        sql, params = mock_cur.execute.call_args[0]
        assert 'account_id' in sql.lower()
        # The literal NULL is in the VALUES list, not in params — params carry
        # the key and value only. Confirm the SQL emits VALUES (NULL, %s, %s, ...)
        assert 'values (null' in sql.lower().replace('  ', ' ')
        assert params == ('hubspot_access_token', 'tok')

    def test_set_config_uses_new_on_conflict_target(self, hubspot_module, mock_deps):
        """The ON CONFLICT target must reference (account_id, config_key) —
        the legacy UNIQUE(config_key) constraint was dropped by the migration."""
        started, mock_conn, mock_cur = mock_deps
        hubspot_module._set_config(mock_conn, 'hubspot_refresh_token', 'rt')

        sql = mock_cur.execute.call_args[0][0].lower()
        assert 'on conflict (account_id, config_key)' in sql
        # Old target must NOT be used — single-column ON CONFLICT (config_key)
        # would fail at runtime against the new index.
        assert 'on conflict (config_key)' not in sql

    def test_get_config_remains_unscoped(self, hubspot_module, mock_deps):
        """HubSpot reads stay deliberately unscoped — the NULL row is unique
        per config_key thanks to NULLS NOT DISTINCT, and HubSpot keys never
        collide with Salesforce/Gong keys (different prefixes)."""
        started, mock_conn, mock_cur = mock_deps
        mock_cur.fetchone.return_value = ('encrypted-value',)
        hubspot_module._get_config(mock_conn, 'hubspot_access_token')

        sql, params = mock_cur.execute.call_args[0]
        # No account_id binding in the read path
        assert params == ('hubspot_access_token',)
        assert 'account_id' not in sql.lower()
