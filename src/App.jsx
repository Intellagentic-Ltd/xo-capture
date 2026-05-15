import React, { useState, useEffect, useMemo } from 'react'
import { X, Upload, Sparkles, FileText, Building2, FileText as FileIcon, Trash2, CheckCircle2, Music, Loader2, CheckCircle, Clock, AlertCircle, AlertTriangle, ChevronDown, ChevronUp, ChevronRight, Database, Calendar, Globe, TrendingUp, Menu, Settings, Moon, Sun, GripVertical, Copy, Edit2, Plus, Home, Zap, Heart, Star, Send, Check, Save, User, Users, Bell, Search, Mail, Phone, MapPin, Play, ExternalLink, Package, LogOut, Lock, Eye, EyeOff, Cloud, FolderOpen, ChevronLeft, HardDrive, MoreVertical, ToggleLeft, ToggleRight, History, RefreshCw, Image, FileSpreadsheet, FileType, File, Download, Link, Share2,FileScan } from 'lucide-react'
import logoLight from './assets/logo-light.png'
import logoDark from './assets/logo-dark.png'
import IntellagenticLogo from './components/IntellagenticLogo'
import intellistackLogo from './assets/intellistack-logo.png'
import intellistackLogoDark from './assets/intellistack-logo-dark.png'

// ============================================================
// XO PROTOTYPE - MAIN APP
// Three screens: Upload -> Enrich -> Results
// ============================================================

const API_BASE = 'https://odvopohlp3.execute-api.eu-west-2.amazonaws.com/prod'

// io.open  — Open a URL via GET or POST (form-based, no CORS issues)
// io.post  — Send JSON via fetch to a URL and return the response (for API calls)
//
// io.open arguments:
//  verb   : 'GET'|'POST'
//  url    : target URL
//  data   : object to send as form fields (POST) or query params (GET)
//  target : an optional opening target (a name, or "_blank"), defaults to "_self"
//
// io.post arguments:
//  url    : target URL (e.g. https://us.streamline.intellistack.ai/api/...)
//  data   : object to send as JSON body
//  headers: optional extra headers
//  Returns: Promise<{ ok, status, data }>
window.io = {
  open: async function(verb, url, data, target) {
    if (verb === 'GET') {
      const params = data ? '?' + new URLSearchParams(
        Object.entries(data).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v])
      ).toString() : ''
      window.open(url + params, target || '_self')
      return
    }
    // POST application/json cross-domain: proxy through backend to avoid CORS,
    // then open the response in a new window.
    const token = sessionStorage.getItem('xo-token')
    const w = window.open('', target || '_self')
    try {
      const res = await fetch(API_BASE + '/proxy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? 'Bearer ' + token : ''
        },
        body: JSON.stringify({ target_url: url, payload: data || {} })
      })
      //const json1 = await res.json();
      //console.log(json1)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      w.location = blobUrl;
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
    } catch (err) {
      console.error('io.open POST failed:', err)
      if (w) w.document.write('<p>Failed to load: ' + err.message + '</p>')
    }
  },

  // POST JSON via backend proxy to avoid CORS — routes through API Gateway
  post: async function(url, data, headers) {
    try {
      const token = sessionStorage.getItem('xo-token')
      const res = await fetch(`${API_BASE}/proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : '',
          ...headers
        },
        body: JSON.stringify({ target_url: url, payload: data || {} })
      })
      const resData = await res.json()
      return { ok: res.ok, status: res.status, data: resData }
    } catch (err) {
      console.error('io.post failed:', err)
      return { ok: false, status: 0, data: { error: err.message } }
    }
  },

  // POST JSON directly (for same-origin or CORS-enabled endpoints)
  postDirect: async function(url, data, headers) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(data || {})
      })
      const resData = await res.json().catch(() => ({}))
      return { ok: res.ok, status: res.status, data: resData }
    } catch (err) {
      console.error('io.postDirect failed:', err)
      return { ok: false, status: 0, data: { error: err.message } }
    }
  },

  // POST JSON and open the response in a new window/tab
  // Sends Content-Type: application/json, opens response as blob URL
  postAndOpen: async function(url, data, target) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {})
      })
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const w = window.open(blobUrl, target || '_blank')
      if (w) w.addEventListener('load', () => URL.revokeObjectURL(blobUrl))
      else setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
      return { ok: res.ok, status: res.status }
    } catch (err) {
      console.error('io.postAndOpen failed:', err)
      return { ok: false, status: 0, error: err.message }
    }
  }
};

// Migrate contact: split legacy "name" into firstName/lastName if needed
function slugifyProblem(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

function migrateContact(c) {
  if (c.firstName !== undefined || c.lastName !== undefined) return c
  const name = c.name || ''
  const spaceIdx = name.indexOf(' ')
  return {
    ...c,
    firstName: spaceIdx > 0 ? name.substring(0, spaceIdx) : name,
    lastName: spaceIdx > 0 ? name.substring(spaceIdx + 1) : '',
  }
}

// Country codes for phone fields
const COUNTRY_CODES = [
  { code: '+1', label: '+1 (US/Canada)' },
  { code: '+44', label: '+44 (UK)' },
  { code: '+61', label: '+61 (Australia)' },
  { code: '+353', label: '+353 (Ireland)' },
  { code: '+256', label: '+256 (Uganda)' },
  { code: '+971', label: '+971 (UAE)' }
]

function splitPhone(phone) {
  if (!phone) return { countryCode: '+1', number: '' }
  for (const { code } of COUNTRY_CODES) {
    if (phone.startsWith(code + ' ')) return { countryCode: code, number: phone.slice(code.length + 1) }
    if (phone.startsWith(code)) return { countryCode: code, number: phone.slice(code.length) }
  }
  return { countryCode: '+1', number: phone }
}

function joinPhone(countryCode, number) {
  const n = number.trim()
  return n ? `${countryCode} ${n}` : countryCode
}

// Auth helpers
function getAuthHeaders() {
  const token = sessionStorage.getItem('xo-token')
  return {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : ''
  }
}

function isTokenExpired(token) {
  try {
    // JWT uses URL-safe base64: replace - with + and _ with / before decoding
    let b64 = token.split('.')[1]
    b64 = b64.replace(/-/g, '+').replace(/_/g, '/')
    // Add padding if needed
    while (b64.length % 4) b64 += '='
    const payload = JSON.parse(atob(b64))
    return payload.exp * 1000 < Date.now()
  } catch {
    return true
  }
}

// ============================================================
// LOGIN SCREEN — Google OAuth + Email/Password fallback
// ============================================================
const GOOGLE_CLIENT_ID = '801271873723-7htidmimhfl2qbdl4jv5leap0tqvu8gh.apps.googleusercontent.com'

function LoginScreen({ onLogin }) {
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotPassword, setForgotPassword] = useState('')
  const [forgotConfirm, setForgotConfirm] = useState('')
  const [forgotError, setForgotError] = useState('')
  const [forgotSuccess, setForgotSuccess] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  // Load Google Identity Services library
  useEffect(() => {
    if (showEmailForm) return // Don't load if showing email form

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: handleGoogleCallback
        })
        window.google.accounts.id.renderButton(
          document.getElementById('google-signin-btn'),
          { theme: 'outline', size: 'large', width: 360, text: 'signin_with' }
        )
      }
    }
    document.body.appendChild(script)

    return () => {
      // Cleanup: remove the script if component unmounts
      if (script.parentNode) script.parentNode.removeChild(script)
    }
  }, [showEmailForm])

  const handleGoogleCallback = async (response) => {
    setError('')
    setLoading(true)

    try {
      const res = await fetch(`${API_BASE}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Google sign-in failed')
        setLoading(false)
        return
      }

      sessionStorage.setItem('xo-token', data.token)
      sessionStorage.setItem('xo-user', JSON.stringify(data.user))
      onLogin(data.user, data.token)
    } catch (err) {
      setError('Connection failed. Please try again.')
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      setError('Email and password are required')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Login failed')
        setLoading(false)
        return
      }

      sessionStorage.setItem('xo-token', data.token)
      sessionStorage.setItem('xo-user', JSON.stringify(data.user))
      onLogin(data.user, data.token)
    } catch (err) {
      setError('Connection failed. Please try again.')
      setLoading(false)
    }
  }

  const handleForgotSubmit = async (e) => {
    e.preventDefault()
    setForgotError('')
    setForgotSuccess('')

    if (!forgotEmail) { setForgotError('Email is required'); return }
    if (!forgotPassword || forgotPassword.length < 8) { setForgotError('Password must be at least 8 characters'); return }
    if (forgotPassword !== forgotConfirm) { setForgotError('Passwords do not match'); return }

    setForgotLoading(true)
    try {
      const response = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail, new_password: forgotPassword })
      })
      const data = await response.json()
      if (!response.ok) { setForgotError(data.error || 'Reset failed'); setForgotLoading(false); return }
      setForgotSuccess('Password reset successfully. You can now sign in.')
      setForgotLoading(false)
    } catch {
      setForgotError('Connection failed. Please try again.')
      setForgotLoading(false)
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '14px 16px 14px 48px',
    background: '#ffffff',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    fontSize: '15px',
    color: '#1a1a1a',
    outline: 'none',
    transition: 'all 0.3s ease',
    boxSizing: 'border-box'
  }

  const inputFocus = (e) => {
    e.target.style.borderColor = '#dc2626'
    e.target.style.boxShadow = '0 0 0 3px rgba(220,38,38,0.1)'
  }
  const inputBlur = (e) => {
    e.target.style.borderColor = '#e5e7eb'
    e.target.style.boxShadow = 'none'
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f5', overflowX: 'hidden', width: '100%' }}>
      {/* Same header as main app */}
      <header className="header" style={{ position: 'relative' }}>
        <div className="header-inner">
          <div className="header-left">
            <div className="header-title">
              <h1>
                <span>XO Capture</span>
                <span className="version-badge">Rapid Prototype</span>
              </h1>
            </div>
          </div>
          <div className="header-right">
            <div style={{cursor:"pointer"}} onClick={()=>{window.open("https://www.intellagentic.io","_blank")}}>
            <IntellagenticLogo height={32} />
            </div>
          </div>
        </div>
      </header>

      {/* Form area */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 20px',
      }}>
        <div style={{ width: '100%', maxWidth: '440px', animation: 'slideUp 0.6s ease-out' }}>
          {/* Invitation heading */}
          <p style={{
            textAlign: 'center', marginBottom: '24px',
            fontSize: '1.05rem', fontWeight: 400, color: '#9ca3af',
            letterSpacing: '0.15em', textTransform: 'uppercase',
          }}>
            Welcome
          </p>

          <div style={{
            background: '#ffffff', padding: '40px', borderRadius: '20px',
            border: '1px solid #e5e7eb', boxShadow: '0 4px 24px rgba(0,0,0,0.06)'
          }}>
            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '12px 16px', borderRadius: '10px', marginBottom: '20px',
                background: '#fef2f2', border: '1px solid #fecaca',
                color: '#dc2626', fontSize: '14px'
              }}>
                <AlertTriangle size={16} /> {error}
              </div>
            )}

            {!showEmailForm ? (
              <>
                {/* Google Sign-In Button */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px', minHeight: '44px' }}>
                  <div id="google-signin-btn"></div>
                  {loading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#6b7280', fontSize: '14px' }}>
                      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                      Signing in...
                    </div>
                  )}
                </div>

                {/* Divider */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '12px', margin: '24px 0'
                }}>
                  <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                  <span style={{ fontSize: '13px', color: '#9ca3af', fontWeight: 500 }}>or</span>
                  <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                </div>

                {/* Email fallback link */}
                <p style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => { setShowEmailForm(true); setError('') }}
                    style={{
                      background: 'none', border: 'none', color: '#6b7280', fontSize: '14px',
                      cursor: 'pointer', textDecoration: 'underline', padding: 0
                    }}
                  >
                    Sign in with email instead
                  </button>
                </p>
              </>
            ) : (
              <>
                {/* Email/Password Form */}
                <form onSubmit={handleSubmit}>
                  {/* Email */}
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                      Email Address
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Mail size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                      <input type="email" placeholder="you@company.com" required value={email}
                        onChange={(e) => { setEmail(e.target.value); setError('') }}
                        style={inputStyle} onFocus={inputFocus} onBlur={inputBlur} />
                    </div>
                  </div>

                  {/* Password */}
                  <div style={{ marginBottom: '28px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '600', color: '#374151' }}>
                      Password
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Lock size={20} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        required value={password}
                        onChange={(e) => { setPassword(e.target.value); setError('') }}
                        style={{ ...inputStyle, paddingRight: '48px' }} onFocus={inputFocus} onBlur={inputBlur} />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        style={{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0, display: 'flex', alignItems: 'center' }}>
                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                  </div>

                  {/* Submit */}
                  <button type="submit" disabled={loading}
                    style={{
                      width: '100%', padding: '16px', background: '#dc2626', border: 'none', borderRadius: '12px',
                      color: 'white', fontSize: '16px', fontWeight: '600', cursor: loading ? 'not-allowed' : 'pointer',
                      transition: 'all 0.3s ease', letterSpacing: '0.02em', opacity: loading ? 0.7 : 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                    }}
                    onMouseEnter={(e) => { if (!loading) { e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 12px 32px rgba(220,38,38,0.3)' } }}
                    onMouseLeave={(e) => { e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none' }}>
                    {loading && <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />}
                    {loading ? 'Signing in...' : 'Continue'}
                  </button>
                </form>

                {/* Forgot Password link */}
                <p style={{ textAlign: 'center', marginTop: '16px' }}>
                  <button
                    type="button"
                    onClick={() => { setShowForgot(true); setForgotEmail(email); setForgotError(''); setForgotSuccess('') }}
                    style={{
                      background: 'none', border: 'none', color: '#9ca3af', fontSize: '13px',
                      cursor: 'pointer', textDecoration: 'underline', padding: 0
                    }}
                  >
                    Forgot Password?
                  </button>
                </p>

                {/* Back to Google */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '12px', margin: '16px 0 8px'
                }}>
                  <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                  <span style={{ fontSize: '13px', color: '#9ca3af', fontWeight: 500 }}>or</span>
                  <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                </div>
                <p style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    onClick={() => { setShowEmailForm(false); setError('') }}
                    style={{
                      background: 'none', border: 'none', color: '#6b7280', fontSize: '14px',
                      cursor: 'pointer', textDecoration: 'underline', padding: 0
                    }}
                  >
                    Sign in with Google
                  </button>
                </p>
              </>
            )}
          </div>

          {/* Forgot Password Form */}
          {showForgot && (
            <div style={{
              marginTop: '16px', background: '#ffffff', padding: '32px', borderRadius: '20px',
              border: '1px solid #e5e7eb', boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
              animation: 'slideUp 0.3s ease-out'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1a1a1a', margin: 0 }}>Reset Password</h3>
                <button
                  type="button"
                  onClick={() => setShowForgot(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0 }}
                >
                  <X size={18} />
                </button>
              </div>

              {forgotError && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 14px', borderRadius: '10px', marginBottom: '16px',
                  background: '#fef2f2', border: '1px solid #fecaca',
                  color: '#dc2626', fontSize: '13px'
                }}>
                  <AlertTriangle size={14} /> {forgotError}
                </div>
              )}

              {forgotSuccess && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 14px', borderRadius: '10px', marginBottom: '16px',
                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                  color: '#16a34a', fontSize: '13px'
                }}>
                  <CheckCircle size={14} /> {forgotSuccess}
                </div>
              )}

              <form onSubmit={handleForgotSubmit}>
                {/* Email */}
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600', color: '#374151' }}>Email</label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                    <input type="email" required value={forgotEmail}
                      onChange={(e) => { setForgotEmail(e.target.value); setForgotError('') }}
                      placeholder="you@company.com"
                      style={{ ...inputStyle, padding: '12px 14px 12px 42px', fontSize: '14px' }}
                      onFocus={inputFocus} onBlur={inputBlur} />
                  </div>
                </div>

                {/* New Password */}
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600', color: '#374151' }}>New Password</label>
                  <div style={{ position: 'relative' }}>
                    <Lock size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                    <input type="password" required value={forgotPassword}
                      onChange={(e) => { setForgotPassword(e.target.value); setForgotError('') }}
                      placeholder="Min. 8 characters"
                      style={{ ...inputStyle, padding: '12px 14px 12px 42px', fontSize: '14px' }}
                      onFocus={inputFocus} onBlur={inputBlur} />
                  </div>
                </div>

                {/* Confirm Password */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600', color: '#374151' }}>Confirm Password</label>
                  <div style={{ position: 'relative' }}>
                    <Lock size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                    <input type="password" required value={forgotConfirm}
                      onChange={(e) => { setForgotConfirm(e.target.value); setForgotError('') }}
                      placeholder="Re-enter password"
                      style={{ ...inputStyle, padding: '12px 14px 12px 42px', fontSize: '14px' }}
                      onFocus={inputFocus} onBlur={inputBlur} />
                  </div>
                </div>

                <button type="submit" disabled={forgotLoading}
                  style={{
                    width: '100%', padding: '14px', background: '#dc2626', border: 'none', borderRadius: '12px',
                    color: 'white', fontSize: '15px', fontWeight: '600', cursor: forgotLoading ? 'not-allowed' : 'pointer',
                    opacity: forgotLoading ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                  }}>
                  {forgotLoading && <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />}
                  {forgotLoading ? 'Resetting...' : 'Reset Password'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Footer -- single row, MFP Ink & Steel pattern */}
      <footer className="app-footer">
        <span className="app-footer-left">
          <IntellagenticLogo height={20} />
          <span className="app-footer-dash">&mdash;</span>
          <span className="app-footer-tagline">The end of guesswork.</span>
        </span>
        <span className="app-footer-right">
          <a href="/terms">Terms</a>
          <span className="app-footer-sep" aria-hidden="true">&middot;</span>
          <a href="/privacy">Privacy</a>
          <span className="app-footer-sep" aria-hidden="true">&middot;</span>
          <a href="/security">Security</a>
          <span className="app-footer-rule" aria-hidden="true" />
          <span className="app-footer-meta">&copy; 2026 INTELLAGENTIC LIMITED.</span>
        </span>
      </footer>
    </div>
  )
}


// ============================================================
// SHARE LINK MODAL — Magic link management for client access
// ============================================================
function ShareLinkModal({ clientId, onClose }) {
  const [loading, setLoading] = useState(true)
  const [linkData, setLinkData] = useState({ token: null, url: null, expires_at: null })
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const fetchLink = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/auth/magic-link?client_id=${clientId}`, {
        headers: getAuthHeaders()
      })
      if (res.ok) {
        const data = await res.json()
        setLinkData(data)
      } else {
        setError('Failed to load link')
      }
    } catch {
      setError('Connection failed')
    }
    setLoading(false)
  }

  useEffect(() => { fetchLink() }, [clientId])

  const generateLink = async () => {
    setGenerating(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/auth/magic-link`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ client_id: clientId })
      })
      if (res.ok) {
        const data = await res.json()
        setLinkData(data)
      } else {
        setError('Failed to generate link')
      }
    } catch {
      setError('Connection failed')
    }
    setGenerating(false)
  }

  const revokeLink = async () => {
    setError('')
    try {
      const res = await fetch(`${API_BASE}/auth/magic-link?client_id=${clientId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (res.ok) {
        setLinkData({ token: null, url: null, expires_at: null })
      } else {
        setError('Failed to revoke link')
      }
    } catch {
      setError('Connection failed')
    }
  }

  const copyLink = () => {
    if (linkData.url) {
      navigator.clipboard.writeText(linkData.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
      <div style={{
        position: 'relative', background: 'var(--bg-card, #fff)', borderRadius: '16px',
        padding: '1.5rem', width: '90%', maxWidth: '480px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Link size={18} /> Share Client Access
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #9ca3af)', padding: '0.25rem' }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Generate a magic link to share with this client. Anyone with the link can access the workspace — no login required.
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#dc2626' }} />
          </div>
        ) : (
          <>
            {error && (
              <div style={{ padding: '0.5rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', fontSize: '0.8125rem', marginBottom: '0.75rem' }}>
                {error}
              </div>
            )}

            {linkData.token ? (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '8px',
                  padding: '0.625rem 0.75rem', marginBottom: '0.5rem'
                }}>
                  <input
                    readOnly
                    value={linkData.url}
                    style={{
                      flex: 1, background: 'none', border: 'none', fontSize: '0.75rem',
                      color: 'var(--text-primary)', outline: 'none', fontFamily: 'monospace'
                    }}
                  />
                  <button
                    onClick={copyLink}
                    style={{
                      background: copied ? '#22c55e' : '#dc2626', border: 'none', borderRadius: '6px',
                      color: 'white', padding: '0.35rem 0.75rem', fontSize: '0.75rem', fontWeight: 600,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                      transition: 'background 0.2s', whiteSpace: 'nowrap'
                    }}
                  >
                    {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                  </button>
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)' }}>
                  Expires: {linkData.expires_at ? new Date(linkData.expires_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown'}
                </div>
              </div>
            ) : (
              <div style={{
                padding: '1rem', textAlign: 'center', background: 'var(--bg-secondary, #f3f4f6)',
                borderRadius: '8px', marginBottom: '1rem', color: 'var(--text-muted, #9ca3af)', fontSize: '0.8125rem'
              }}>
                No active link
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={generateLink}
                disabled={generating}
                className="action-btn red"
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {generating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Link size={14} />}
                {linkData.token ? 'Regenerate' : 'Generate Link'}
              </button>
              {linkData.token && (
                <button
                  onClick={revokeLink}
                  className="action-btn"
                  style={{ color: '#ef4444' }}
                >
                  <Trash2 size={14} /> Revoke
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}


// ============================================================
// DASHBOARD SCREEN — Admin multi-client view
// ============================================================
function DashboardScreen({ onSelectClient, onCreateClient, isAdmin, isAccount, accounts, teamUsers, user }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deleteConfirmClient, setDeleteConfirmClient] = useState(null)
  const [shareLinkClient, setShareLinkClient] = useState(null)
  // PR 4: cross-tenant share modal — separate from shareLinkClient (which
  // is the magic-link / client_contact flow).
  const [shareWithClient, setShareWithClient] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterPartner, setFilterPartner] = useState('')
  const [filterIndustry, setFilterIndustry] = useState('')

  const industries = useMemo(() => [...new Set(clients.map(c => c.industry).filter(Boolean))].sort(), [clients])

  const filteredClients = useMemo(() => {
    let result = clients
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(c =>
        (c.company_name || '').toLowerCase().includes(q) ||
        (c.industry || '').toLowerCase().includes(q)
      )
    }
    if (filterPartner === 'direct') {
      result = result.filter(c => !c.account_id)
    } else if (filterPartner) {
      result = result.filter(c => String(c.account_id) === filterPartner)
    }
    if (filterIndustry) {
      result = result.filter(c => c.industry === filterIndustry)
    }
    return [...result].sort((a, b) =>
      (a.company_name || '').localeCompare(b.company_name || '', undefined, { sensitivity: 'base' })
    )
  }, [clients, searchQuery, filterPartner, filterIndustry])

  useEffect(() => {
    fetchClients()
  }, [])

  const fetchClients = async () => {
    try {
      const res = await fetch(`${API_BASE}/clients/list`, { headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        setClients(data.clients || [])
      } else {
        setError('Failed to load clients')
      }
    } catch {
      setError('Connection failed')
    }
    setLoading(false)
  }

  const deleteClient = async (client) => {
    try {
      const res = await fetch(`${API_BASE}/clients?client_id=${client.client_id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (res.ok) {
        setDeleteConfirmClient(null)
        fetchClients()
      } else {
        alert('Failed to delete client')
      }
    } catch {
      alert('Failed to delete client')
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#dc2626', margin: '0 auto 1rem' }} />
        <p style={{ color: 'var(--text-muted, #6b7280)' }}>Loading clients...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <AlertTriangle size={32} style={{ color: '#dc2626', margin: '0 auto 1rem' }} />
        <p style={{ color: 'var(--text-muted, #6b7280)' }}>{error}</p>
        <button onClick={fetchClients} className="action-btn" style={{ marginTop: '1rem' }}>
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    )
  }

  if (clients.length === 0) {
    return (
      <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <Building2 size={48} style={{ color: 'var(--text-muted, #9ca3af)', margin: '0 auto 1rem' }} />
        <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No clients yet</h3>
        <p style={{ color: 'var(--text-muted, #6b7280)', marginBottom: '1.5rem' }}>Create your first client to get started.</p>
        <button onClick={onCreateClient} className="action-btn red" style={{ margin: '0 auto' }}>
          <Plus size={16} /> Create First Client
        </button>
      </div>
    )
  }

  const borderColor = (status) => {
    if (status === 'complete' || status === 'completed') return '#22c55e'
    if (status === 'error' || status === 'failed') return '#dc2626'
    if (status === 'processing') return '#eab308'
    return '#d1d5db'
  }

  const enrichedClients = filteredClients.filter(c => ['complete', 'completed', 'processing'].includes(c.enrichment_status))
  const needsEnrichment = filteredClients.filter(c => !['complete', 'completed', 'processing'].includes(c.enrichment_status))

  const renderRow = (client) => (
    <div
      key={client.id}
      onClick={() => onSelectClient(client)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.55rem 0.875rem',
        cursor: 'pointer',
        transition: 'background 0.15s',
        borderLeft: `3px solid ${borderColor(client.enrichment_status)}`,
        borderBottom: '1px solid var(--border-color, #e5e7eb)',
        position: 'relative'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-card-alt, #fafafa)'
        e.currentTarget.querySelectorAll('[data-hover-btn]').forEach(el => el.style.opacity = '1')
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.querySelectorAll('[data-hover-btn]').forEach(el => el.style.opacity = '0')
      }}
    >
      {client.icon_url ? (
        <img src={client.icon_url} alt="" style={{ width: '24px', height: '24px', objectFit: 'contain', borderRadius: '6px', flexShrink: 0 }} />
      ) : (
        <div style={{
          width: '24px', height: '24px', borderRadius: '6px', flexShrink: 0,
          background: 'var(--bg-secondary, #f3f4f6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.7rem', fontWeight: 700, color: '#dc2626'
        }}>
          {(client.company_name || '?')[0].toUpperCase()}
        </div>
      )}
      <div style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {client.company_name}
          </span>
          {/* PR 4: cross-tenant share badge. When the row's owning account
              differs from the viewer's account, this client is reaching the
              viewer via a client_shares grant. The list endpoint already
              returns the owner's account_id + account_name (see
              handle_list_clients). Super admins see every row (no badge —
              they're not "shared with" anyone).
              When user is super_admin or has no account_id, we suppress the
              badge to avoid the false "shared from Intellagentic" on
              Intellagentic's own list. */}
          {user && user.account_id != null && !user.is_admin &&
           user.account_role !== 'super_admin' &&
           client.account_id != null && client.account_id !== user.account_id && (
            <span title={`Owned by ${client.account_name || 'another account'}`}
              style={{
                fontSize: '0.65rem', fontWeight: 600,
                padding: '0.1rem 0.4rem', borderRadius: 6,
                background: 'rgba(15, 150, 156, 0.12)', color: '#0F969C',
                whiteSpace: 'nowrap',
              }}>
              Shared from {client.account_name || 'partner'}
            </span>
          )}
        </span>
        {isAdmin && client.account_name && (
          <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted, #9ca3af)', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            via {client.account_name}
          </span>
        )}
      </div>
      {client.industry && (
        <span className="hide-narrow" style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
          {client.industry}
        </span>
      )}
      {client.updated_at && (
        <span className="hide-narrow" style={{ fontSize: '0.6875rem', color: 'var(--text-muted, #9ca3af)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>
          {client.updated_at?"Last Updated: "+formatDateTime(client.updated_at)+(client.updated_by?" by "+client.updated_by:" ") :""}
        </span>
      )}
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #6b7280)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '3px' }}>
        <FolderOpen size={12} /> {client.source_count}
      </span>
      {client.enrichment_date && (
        <span className="hide-narrow" style={{ fontSize: '0.6875rem', color: 'var(--text-muted, #9ca3af)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {new Date(client.enrichment_date).toLocaleDateString()}
        </span>
      )}
      <button
        data-hover-btn
        onClick={(e) => { e.stopPropagation(); setShareLinkClient(client) }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem',
          color: 'var(--text-muted, #9ca3af)', borderRadius: '4px', display: 'flex', flexShrink: 0,
          opacity: 0, transition: 'opacity 0.15s'
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#3b82f6'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted, #9ca3af)'}
        title="Share link (magic link for client contact)"
      >
        <ExternalLink size={13} />
      </button>
      {/* PR 4 + hotfix: cross-tenant share button.
          - XO ADMIN (is_admin=true, legacy role='admin') is system-wide
            and typically has user.account_id = null/unset. They share
            on behalf of any tenant, so we skip the ownership check.
            The ShareClientModal's recipient picker still lists all
            accounts so they pick the destination explicitly.
          - super_admin / account_admin within an owning tenant can
            share only clients THEY own — ownership check stays.
          - Recipients can't re-grant onward (backend enforces this
            even if the UI somehow slipped through).
          - Type-coerce account_id comparison via Number() defensively
            in case the JWT delivers a string for some reason. is_admin
            doesn't need it (no comparison happens). */}
      {user && (
        user.is_admin ||
        (['super_admin', 'account_admin'].includes(user.account_role)
          && client.account_id != null
          && user.account_id != null
          && Number(client.account_id) === Number(user.account_id))
      ) && (
        <button
          data-hover-btn
          onClick={(e) => { e.stopPropagation(); setShareWithClient(client) }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem',
            color: 'var(--text-muted, #9ca3af)', borderRadius: '4px', display: 'flex', flexShrink: 0,
            opacity: 0, transition: 'opacity 0.15s'
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#0F969C'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted, #9ca3af)'}
          title="Share with another XO account"
        >
          <Share2 size={13} />
        </button>
      )}
      {isAdmin && (
        <button
          data-hover-btn
          onClick={(e) => { e.stopPropagation(); setDeleteConfirmClient(client) }}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem',
            color: 'var(--text-muted, #9ca3af)', borderRadius: '4px', display: 'flex', flexShrink: 0,
            opacity: 0, transition: 'opacity 0.15s'
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted, #9ca3af)'}
          title="Delete client"
        >
          <Trash2 size={13} />
        </button>
      )}
      <ChevronRight size={14} style={{ color: 'var(--text-muted, #9ca3af)', flexShrink: 0 }} />
    </div>
  )

  return (
    <div style={{ padding: '1.5rem', maxWidth: '100%', overflowX: 'hidden' }}>
      {/* Row 1: Title + action buttons (Run dXO + New Client) */}
      <div data-dxo="dashboard-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {isAccount && !isAdmin ? 'My Clients' : 'All Clients'} <span style={{ fontWeight: 400, color: 'var(--text-muted, #6b7280)', fontSize: '0.8125rem' }}>({filteredClients.length})</span>
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <a href="?dxo=1" data-dxo="run-dxo" className="action-btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Self-guided XO Capture demo">
            <Play size={14} /> Run dXO
          </a>
          <button onClick={onCreateClient} className="action-btn red" style={{ flexShrink: 0 }}>
            <Plus size={14} /> New Client
          </button>
        </div>
      </div>
      {/* Row 2: Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: '0.875rem', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search clients..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ width: 300, padding: '0.45rem 0.625rem', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 6, background: 'var(--bg-input, #fff)', color: 'var(--text-primary)', outline: 'none', height: 36 }}
        />
        {isAdmin && (
          <select value={filterPartner} onChange={e => setFilterPartner(e.target.value)} aria-label="Filter by partner"
            style={{ width: 150, padding: '0.45rem 0.5rem', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 6, background: 'var(--bg-input, #fff)', color: 'var(--text-primary)', outline: 'none', height: 36 }}>
            <option value="">All Partners</option>
            <option value="direct">Direct (Intellagentic)</option>
            {accounts.map(p => <option key={p.id} value={String(p.id)}>{p.company || p.name}</option>)}
          </select>
        )}
        {industries.length > 0 && (
          <select value={filterIndustry} onChange={e => setFilterIndustry(e.target.value)} aria-label="Filter by industry"
            style={{ width: 150, padding: '0.45rem 0.5rem', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 6, background: 'var(--bg-input, #fff)', color: 'var(--text-primary)', outline: 'none', height: 36 }}>
            <option value="">All Industries</option>
            {industries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
          </select>
        )}
      </div>

      {/* Client list */}
      <div style={{
        background: 'var(--bg-card, #ffffff)',
        border: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: '10px',
        overflow: 'hidden'
      }}>
        {enrichedClients.map(renderRow)}
        {enrichedClients.length > 0 && needsEnrichment.length > 0 && (
          <div style={{
            padding: '0.3rem 0.875rem',
            fontSize: '0.6875rem',
            fontWeight: 600,
            color: 'var(--text-muted, #9ca3af)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            background: 'var(--bg-card-alt, #fafafa)',
            borderBottom: '1px solid var(--border-color, #e5e7eb)'
          }}>
            Needs Enrichment
          </div>
        )}
        {needsEnrichment.map(renderRow)}
      </div>

      {filteredClients.length === 0 && clients.length > 0 && (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.8125rem' }}>No clients match "{searchQuery}"</p>
        </div>
      )}

      {/* Delete Client Confirmation Modal */}
      {shareLinkClient && (
        <ShareLinkModal
          clientId={shareLinkClient.client_id}
          onClose={() => setShareLinkClient(null)}
        />
      )}

      {/* PR 4: cross-tenant share modal */}
      {shareWithClient && (
        <ShareClientModal
          apiBase={API_BASE}
          getAuthHeaders={getAuthHeaders}
          clientId={shareWithClient.id}
          clientName={shareWithClient.company_name}
          isSuperAdmin={!!(user && (user.is_admin || user.account_role === 'super_admin'))}
          onClose={() => setShareWithClient(null)}
        />
      )}

      {deleteConfirmClient && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
          justifyContent: 'center', zIndex: 100
        }}
          onClick={() => setDeleteConfirmClient(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#ffffff',
              border: '1px solid #e5e7eb',
              borderRadius: '12px', padding: '1.5rem', maxWidth: '400px', width: '90%',
              textAlign: 'center',
              boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1)'
            }}
          >
            <Trash2 size={32} style={{ color: '#ef4444', margin: '0 auto 0.75rem' }} />
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1a1a1a', marginBottom: '0.5rem' }}>
              Delete {deleteConfirmClient.company_name}?
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#444444', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              This will permanently remove the client and all their sources, enrichments, and branding. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
              <button
                onClick={() => setDeleteConfirmClient(null)}
                style={{
                  padding: '0.5rem 1.25rem', borderRadius: '8px', fontSize: '0.85rem',
                  background: '#f3f4f6',
                  border: '1px solid #d1d5db', color: '#333333',
                  cursor: 'pointer', fontWeight: 500
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteClient(deleteConfirmClient)}
                style={{
                  padding: '0.5rem 1.25rem', borderRadius: '8px', fontSize: '0.85rem',
                  background: '#ef4444', border: 'none', color: '#ffffff',
                  cursor: 'pointer', fontWeight: 600
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Restore session synchronously before first render
function getInitialAuth() {
  try {
    const token = sessionStorage.getItem('xo-token')
    const savedUser = sessionStorage.getItem('xo-user')
    if (token && savedUser && !isTokenExpired(token)) {
      return { loggedIn: true, user: JSON.parse(savedUser), token }
    }
  } catch {
    // JSON parse or sessionStorage error -- fall through
  }
  sessionStorage.removeItem('xo-token')
  sessionStorage.removeItem('xo-user')
  return { loggedIn: false, user: null, token: null }
}

// ============================================================
// INVITE LANDING PAGE — /invite (public, no auth)
// ============================================================
function InvitePage() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phoneCode, setPhoneCode] = useState('+1')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [leadSource, setLeadSource] = useState('HIMSS 2026')
  const [leadSourceOther, setLeadSourceOther] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [countdown, setCountdown] = useState({ days: 0, hrs: 0, min: 0, sec: 0 })

  // Countdown to March 23, 2026 12:00 PM PDT
  useEffect(() => {
    const target = new Date('2026-03-23T19:00:00Z').getTime()
    const update = () => {
      const now = Date.now()
      const diff = Math.max(0, target - now)
      setCountdown({
        days: Math.floor(diff / 86400000),
        hrs: Math.floor((diff % 86400000) / 3600000),
        min: Math.floor((diff % 3600000) / 60000),
        sec: Math.floor((diff % 60000) / 1000)
      })
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!firstName.trim() || !email.trim() || !phoneNumber.trim() || !companyName.trim()) {
      setError('All fields are required')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: joinPhone(phoneCode, phoneNumber),
          linkedin: linkedin.trim(),
          company_name: companyName.trim(),
          lead_source: leadSource === 'Other' ? (leadSourceOther.trim() || 'Other') : leadSource
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong')
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const pad = (n) => String(n).padStart(2, '0')

  return (
    <div style={{
      height: '100vh',
      overflow: 'hidden',
      background: 'linear-gradient(180deg, #0a0a0f 0%, #1a1a2e 50%, #0a0a0f 100%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#e0e0e0',
      padding: '0 16px',
      boxSizing: 'border-box',
      gap: '6px'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '18px', fontWeight: 600, color: '#fff', letterSpacing: '1px' }}>Capture</span>
      </div>

      {/* Title */}
      <h1 style={{
        margin: 0,
        fontSize: '30px',
        fontWeight: 200,
        letterSpacing: '6px',
        textTransform: 'uppercase',
        color: '#fff',
        textAlign: 'center'
      }}>Invitation</h1>

      {/* Tagline */}
      <p style={{
        margin: 0,
        fontSize: '14px',
        color: '#e0e0e0',
        letterSpacing: '2px',
        textAlign: 'center',
        lineHeight: 1.6,
        fontWeight: 300
      }}>XO clears the path.<br />You decide. Streamline Acts.</p>

      {/* Countdown */}
      <div style={{ display: 'flex', gap: '8px' }}>
        {[
          { val: countdown.days, label: 'Days' },
          { val: countdown.hrs, label: 'Hrs' },
          { val: countdown.min, label: 'Min' },
          { val: countdown.sec, label: 'Sec' }
        ].map(({ val, label }) => (
          <div key={label} style={{
            background: 'rgba(220, 38, 38, 0.1)',
            border: '1px solid rgba(220, 38, 38, 0.3)',
            borderRadius: '6px',
            width: '52px',
            padding: '5px 0',
            textAlign: 'center'
          }}>
            <div style={{
              fontSize: '20px',
              fontWeight: 700,
              fontFamily: '"SF Mono", "Fira Code", monospace',
              color: '#fff'
            }}>{pad(val)}</div>
            <div style={{ fontSize: '8px', color: '#888', letterSpacing: '1px', marginTop: '1px' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Subtle text */}
      <p style={{
        margin: 0,
        fontSize: '13px',
        color: '#c0c0c0',
        letterSpacing: '3px',
        fontStyle: 'italic'
      }}>Your Second-in-Command</p>

      {/* Form or Confirmation */}
      <div style={{
        width: '100%',
        maxWidth: '400px'
      }}>
        {!result ? (
          <form onSubmit={handleSubmit} style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            padding: '14px 18px',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)'
          }}>
            {/* First + Last Name row */}
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              {[
                { label: 'First Name', value: firstName, set: setFirstName, auto: 'given-name' },
                { label: 'Last Name', value: lastName, set: setLastName, auto: 'family-name' }
              ].map(({ label, value, set, auto }) => (
                <div key={label} style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '10px', color: '#888', marginBottom: '2px', letterSpacing: '1px' }}>{label}</label>
                  <input type="text" value={value} onChange={e => set(e.target.value)} autoComplete={auto} required
                    style={{ width: '100%', padding: '8px 10px', fontSize: '16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff', outline: 'none', transition: 'border-color 0.2s', boxSizing: 'border-box' }}
                    onFocus={e => e.target.style.borderColor = 'rgba(220, 38, 38, 0.6)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'} />
                </div>
              ))}
            </div>

            {/* Email, Phone, LinkedIn, Company */}
            {[
              { label: 'Email', value: email, set: setEmail, auto: 'email', type: 'email', req: true },
              { label: 'Phone', isPhone: true, req: true },
              { label: 'linkedin', value: linkedin, set: setLinkedin, auto: 'url', type: 'url', req: false, placeholder: 'linkedin.com/in/yourprofile' },
              { label: 'Company', value: companyName, set: setCompanyName, auto: 'organization', type: 'text', req: true }
            ].map(({ label, value, set, auto, type, req, placeholder, isPhone }) => (
              <div key={label} style={{ marginBottom: '6px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#888', marginBottom: '2px', letterSpacing: '1px' }}>
                  {label === 'linkedin' ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="#888"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  ) : label}
                  {!req && <span style={{ fontSize: '9px', color: '#666', fontStyle: 'italic' }}>(optional)</span>}
                </label>
                {isPhone ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <select value={phoneCode} aria-label="Country code" onChange={e => setPhoneCode(e.target.value)}
                      style={{
                        width: '90px', flexShrink: 0, padding: '8px 4px', fontSize: '14px',
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '6px', color: '#fff', outline: 'none'
                      }}>
                      {COUNTRY_CODES.map(cc => <option key={cc.code} value={cc.code} style={{ background: '#1a1a2e' }}>{cc.label}</option>)}
                    </select>
                    <input type="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
                      autoComplete="tel" required
                      style={{
                        flex: 1, padding: '8px 10px', fontSize: '16px',
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '6px', color: '#fff', outline: 'none', transition: 'border-color 0.2s',
                        boxSizing: 'border-box'
                      }}
                      onFocus={e => e.target.style.borderColor = 'rgba(220, 38, 38, 0.6)'}
                      onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'} />
                  </div>
                ) : (
                  <input
                    type={type}
                    value={value}
                    onChange={e => set(e.target.value)}
                    autoComplete={auto}
                    required={req}
                    placeholder={placeholder || ''}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      fontSize: '16px',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '6px',
                      color: '#fff',
                      outline: 'none',
                      transition: 'border-color 0.2s',
                      boxSizing: 'border-box'
                    }}
                    onFocus={e => e.target.style.borderColor = 'rgba(220, 38, 38, 0.6)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.12)'}
                  />
                )}
              </div>
            ))}

            {/* How did you hear about us? */}
            <div style={{ marginBottom: '6px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#888', marginBottom: '2px', letterSpacing: '1px' }}>
                How did you hear about us?
              </label>
              <select value={leadSource} aria-label="Lead source" onChange={e => setLeadSource(e.target.value)}
                style={{
                  width: '100%', padding: '8px 10px', fontSize: '16px',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '6px', color: '#fff', outline: 'none', boxSizing: 'border-box'
                }}>
                {['HIMSS 2026', 'LinkedIn', 'Referral', 'Website', 'Other'].map(opt => (
                  <option key={opt} value={opt} style={{ background: '#1a1a2e' }}>{opt}</option>
                ))}
              </select>
              {leadSource === 'Other' && (
                <input type="text" value={leadSourceOther} onChange={e => setLeadSourceOther(e.target.value)}
                  placeholder="Please specify"
                  style={{
                    width: '100%', marginTop: '4px', padding: '8px 10px', fontSize: '16px',
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '6px', color: '#fff', outline: 'none', boxSizing: 'border-box'
                  }} />
              )}
            </div>

            {error && (
              <div style={{ color: '#ef4444', fontSize: '12px', marginBottom: '4px' }}>{error}</div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '11px',
                fontSize: '15px',
                fontWeight: 600,
                background: submitting ? '#991b1b' : '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                cursor: submitting ? 'not-allowed' : 'pointer',
                letterSpacing: '1px',
                marginTop: '2px',
                transition: 'background 0.2s'
              }}
            >
              {submitting ? 'Processing...' : "I'm In"}
            </button>
          </form>
        ) : (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '14px',
            padding: '32px 22px',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            textAlign: 'center'
          }}>
            <CheckCircle size={40} style={{ color: '#22c55e', marginBottom: '12px' }} />
            <h2 style={{ fontSize: '24px', fontWeight: 600, color: '#fff', margin: '0 0 8px' }}>You're in.</h2>
            <p style={{ color: '#aaa', fontSize: '15px', margin: '0 0 24px' }}>We'll send your access on March 23.</p>
            <span style={{ opacity: 0.5 }}><IntellagenticLogo height={22} /></span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: '2px' }}>
        <span style={{ fontSize: '10px', color: '#808080' }}>&copy; 2026 Intellagentic Limited. All rights reserved.</span>
      </div>
    </div>
  )
}

// ============================================================
// LEGAL PAGES — /terms, /privacy, /security
// Public pages, no auth required
// ============================================================

const LEGAL_STYLES = {
  page: { maxWidth: 740, margin: '0 auto', padding: '2.5rem 1.5rem 4rem', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', fontSize: 16, lineHeight: 1.7, color: '#1a1a2e' },
  backLink: { display: 'inline-block', marginBottom: '1.5rem', fontSize: '0.85rem', color: '#CC0000', textDecoration: 'none' },
  title: { fontSize: '2rem', fontWeight: 700, margin: '0 0 0.25rem' },
  subtitle: { fontSize: '0.9rem', color: '#666', margin: '0 0 0.15rem' },
  version: { fontSize: '0.82rem', color: '#888', margin: '0 0 2rem' },
  callout: { background: '#f7f7f9', border: '1px solid #d0d0d8', borderRadius: 6, padding: '1rem 1.25rem', margin: '1.25rem 0', fontSize: '0.92rem', lineHeight: 1.6 },
  h2: { fontSize: '1.3rem', fontWeight: 600, margin: '2rem 0 0.75rem', color: '#1a1a2e' },
  h3: { fontSize: '1.1rem', fontWeight: 600, margin: '1.5rem 0 0.5rem', color: '#1a1a2e' },
  p: { margin: '0.75rem 0' },
  ul: { margin: '0.5rem 0 0.75rem 1.5rem' },
  li: { margin: '0.35rem 0' },
  table: { width: '100%', borderCollapse: 'collapse', margin: '1rem 0', fontSize: '0.92rem' },
  th: { background: '#f5f5f7', border: '1px solid #d0d0d8', padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600 },
  td: { border: '1px solid #d0d0d8', padding: '0.5rem 0.75rem' },
  link: { color: '#CC0000' },
  footer: { marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid #e0e0e0', fontSize: '0.82rem', color: '#888', textAlign: 'center', lineHeight: 1.6 },
}

// ============================================================
// ACCEPT INVITE PAGE — /accept-invite?token=xxx (public, no auth)
// ============================================================
function AcceptInvitePage({ onLogin }) {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') || '')
  const [loading, setLoading] = useState(true)
  const [inviteData, setInviteData] = useState(null)
  const [error, setError] = useState(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (!token) { setError('invalid'); setLoading(false); return }
    fetch(`${API_BASE}/auth/invite/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.valid) setInviteData(data)
        else setError(data.reason || 'invalid')
      })
      .catch(() => setError('invalid'))
      .finally(() => setLoading(false))
  }, [token])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 8) { setSubmitError('Password must be at least 8 characters'); return }
    if (password !== confirmPassword) { setSubmitError('Passwords do not match'); return }
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch(`${API_BASE}/auth/invite/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to accept invitation')
      if (data.token && data.user) {
        onLogin(data.user, data.token)
      }
    } catch (err) {
      setSubmitError(err.message)
    }
    setSubmitting(false)
  }

  const containerStyle = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0a0a0f 100%)' }
  const cardStyle = { background: '#fff', borderRadius: 16, padding: '2.5rem', width: '90%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }
  const inputStyle = { width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: 8, fontSize: '0.9rem', fontFamily: 'inherit', outline: 'none', marginBottom: '0.75rem' }

  if (loading) return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#dc2626', margin: '0 auto' }} />
          <p style={{ marginTop: '1rem', color: '#6b7280' }}>Validating invitation...</p>
        </div>
      </div>
    </div>
  )

  if (error) return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <AlertCircle size={40} style={{ color: '#dc2626', margin: '0 auto 1rem' }} />
          {error === 'expired' ? (
            <>
              <h2 style={{ fontSize: '1.25rem', color: '#111', marginBottom: '0.5rem' }}>Invitation Expired</h2>
              <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>This invitation has expired. Please contact your administrator to resend.</p>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: '1.25rem', color: '#111', marginBottom: '0.5rem' }}>Invalid Invitation</h2>
              <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>This invitation link is invalid or has already been used.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', marginBottom: '1rem' }}>
            <span style={{ fontWeight: 700, fontSize: '1.2rem', color: '#1a1a2e' }}>Intellagentic</span>
            <span style={{ fontWeight: 700, fontSize: '1.2rem', color: '#CC0000' }}>XO</span>
          </div>
          <h2 style={{ fontSize: '1.25rem', color: '#111', marginBottom: '0.25rem' }}>Welcome, {inviteData.name}</h2>
          <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>You've been invited to join <strong>{inviteData.account_name}</strong></p>
        </div>
        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' }}>Email</label>
          <input type="email" value={inviteData.email} disabled style={{ ...inputStyle, background: '#f3f4f6', color: '#6b7280' }} />
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' }}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimum 8 characters" style={inputStyle} autoFocus />
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: '0.25rem' }}>Confirm Password</label>
          <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm password" style={inputStyle} />
          {submitError && <p style={{ color: '#dc2626', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{submitError}</p>}
          <button type="submit" disabled={submitting || !password || !confirmPassword}
            style={{ width: '100%', padding: '0.75rem', background: '#CC0000', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.9rem', fontWeight: 600, cursor: submitting ? 'wait' : 'pointer', opacity: submitting ? 0.7 : 1, marginTop: '0.5rem' }}>
            {submitting ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}


function LegalHeader({ title }) {
  return (
    <>
      <a href="/" style={LEGAL_STYLES.backLink}>&larr; Back to XO Capture</a>
      <h1 style={LEGAL_STYLES.title}>{title}</h1>
      <p style={LEGAL_STYLES.subtitle}>XO Capture &mdash; Intellagentic Limited</p>
      <p style={LEGAL_STYLES.version}>Last Updated: 29 March 2026 | Version 1.0</p>
    </>
  )
}

function LegalFooter() {
  return (
    <div style={LEGAL_STYLES.footer}>
      Intellagentic Limited | Company No. 16761110 | 7 Penrose Mews, Lillie Road, London SW6 7AW
    </div>
  )
}

function TermsPage() {
  const S = LEGAL_STYLES
  return (
    <div style={S.page}>
      <LegalHeader title="Terms and Conditions" />

      <div style={S.callout}>
        <strong>IMPORTANT:</strong> Please read these Terms and Conditions carefully before accessing XO Capture or engaging our Consulting Services. By using XO Capture, you agree to be bound by these terms. For users in the United States, this Agreement includes a binding arbitration clause and class action waiver (see Section 10).
      </div>

      <h2 style={S.h2}>1. Company Information</h2>
      <ul style={S.ul}>
        <li style={S.li}><strong>Entity:</strong> Intellagentic Limited</li>
        <li style={S.li}><strong>Company Number:</strong> 16761110</li>
        <li style={S.li}><strong>Registered Address:</strong> 7 Penrose Mews, Lillie Road, London, England, SW6 7AW</li>
        <li style={S.li}><strong>Contact:</strong> <a href="mailto:legal@intellagentic.io" style={S.link}>legal@intellagentic.io</a></li>
      </ul>

      <h2 style={S.h2}>2. Definitions</h2>
      <ul style={S.ul}>
        <li style={S.li}><strong>&ldquo;Platform&rdquo;</strong> or <strong>&ldquo;XO Capture&rdquo;</strong> &mdash; The web-based capture, analysis, and intelligence product operated by Intellagentic Limited at xo.intellagentic.io (or such successor domain as we may designate).</li>
        <li style={S.li}><strong>&ldquo;Captured Content&rdquo;</strong> &mdash; Any text, media, documents, or data you submit to or generate through XO Capture.</li>
        <li style={S.li}><strong>&ldquo;Consulting Services&rdquo;</strong> &mdash; Any professional services, advisory engagements, or implementation work provided by Intellagentic Limited outside the Platform.</li>
        <li style={S.li}><strong>&ldquo;You&rdquo;</strong> / <strong>&ldquo;User&rdquo;</strong> &mdash; Any individual or entity accessing XO Capture, whether as a direct customer or as an authorised user of a client organisation.</li>
      </ul>

      <h2 style={S.h2}>3. Licence and Use of Service</h2>
      <p style={S.p}>We grant you a limited, non-exclusive, non-transferable, revocable licence to access and use XO Capture in accordance with these Terms and any applicable subscription or service agreement.</p>
      <p style={S.p}>You agree not to:</p>
      <ul style={S.ul}>
        <li style={S.li}>Reverse engineer, decompile, or disassemble any part of the Platform.</li>
        <li style={S.li}>Use the Platform for unauthorised data scraping, competitive intelligence harvesting, or any unlawful purpose.</li>
        <li style={S.li}>Attempt to circumvent access controls, authentication mechanisms, or usage limits.</li>
        <li style={S.li}>Sublicence, resell, or redistribute access to the Platform without our prior written consent.</li>
      </ul>

      <h2 style={S.h2}>4. User Responsibilities</h2>
      <p style={S.p}>You are solely responsible for ensuring that your Captured Content and your use of XO Capture comply with all applicable laws and regulations in your jurisdiction, including (without limitation) data protection laws, export controls, and intellectual property rights of third parties.</p>
      <p style={S.p}>You must be at least 18 years of age (or the age of majority in your jurisdiction) to use XO Capture.</p>

      <h2 style={S.h2}>5. AI-Generated Outputs</h2>
      <p style={S.p}>XO Capture uses artificial intelligence models (including third-party models hosted on AWS Bedrock) to process and analyse your Captured Content. AI-generated outputs are provided for informational and decision-support purposes only and do not constitute professional advice (legal, financial, medical, or otherwise).</p>
      <p style={S.p}>You acknowledge that AI outputs may contain errors, omissions, or hallucinations. You are responsible for reviewing and validating all AI-generated outputs before acting on them.</p>

      <h2 style={S.h2}>6. Intellectual Property</h2>
      <h3 style={S.h3}>6.1 Platform IP</h3>
      <p style={S.p}>XO Capture, its architecture, the XO runtime framework, YAML configuration schemas, skill files, evaluation layers, and all related intellectual property are and remain the exclusive property of Intellagentic Limited (&ldquo;Background IP&rdquo;).</p>
      <h3 style={S.h3}>6.2 Your Content</h3>
      <p style={S.p}>You retain ownership of your Captured Content. By submitting content to the Platform, you grant Intellagentic Limited a limited licence to process, store, and analyse that content solely for the purpose of delivering the Service to you.</p>
      <h3 style={S.h3}>6.3 DMCA (US Users)</h3>
      <p style={S.p}>If you believe content on our Platform infringes your copyright under the Digital Millennium Copyright Act, please submit a notice to our designated agent at <a href="mailto:legal@intellagentic.io" style={S.link}>legal@intellagentic.io</a> with the information required under 17 U.S.C. &sect; 512(c)(3).</p>

      <h2 style={S.h2}>7. Data Processing and Privacy</h2>
      <p style={S.p}>Our collection and use of personal data is governed by our <a href="/privacy" style={S.link}>Privacy Policy</a>. Where we process personal data on your behalf as a Data Processor, the terms of our Data Processing Addendum (available on request) shall apply.</p>

      <h2 style={S.h2}>8. Limitation of Liability</h2>
      <p style={S.p}>To the maximum extent permitted by applicable law:</p>
      <ul style={S.ul}>
        <li style={S.li}>Our total aggregate liability arising out of or in connection with these Terms shall not exceed the amounts paid by you to Intellagentic Limited in the 12 months immediately preceding the event giving rise to the claim.</li>
        <li style={S.li}>We shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or business opportunity.</li>
        <li style={S.li}>Nothing in these Terms excludes or limits liability for fraud, death or personal injury caused by negligence, or any other liability that cannot be excluded by law.</li>
      </ul>

      <h2 style={S.h2}>9. Term, Suspension, and Termination</h2>
      <p style={S.p}>These Terms remain in effect for so long as you maintain an active account or subscription. We may suspend or terminate your access at any time if you breach these Terms, if required by law, or if we discontinue the Service (with reasonable notice where practicable). Upon termination, you may request an export of your Captured Content for a period of 30 days, after which we may delete it.</p>

      <h2 style={S.h2}>10. Governing Law and Disputes</h2>
      <h3 style={S.h3}>10.1 Governing Law</h3>
      <p style={S.p}>These Terms are governed by and construed in accordance with the laws of England and Wales. The courts of England and Wales shall have exclusive jurisdiction, subject to the arbitration provisions below for US users.</p>
      <h3 style={S.h3}>10.2 US Dispute Resolution</h3>
      <p style={S.p}>If you are located in the United States, any dispute arising from or relating to these Terms shall be resolved through binding individual arbitration administered by JAMS under its Streamlined Arbitration Rules and Procedures. You agree to waive any right to participate in a class action, class arbitration, or representative proceeding. This arbitration clause does not prevent either party from seeking injunctive relief in a court of competent jurisdiction.</p>

      <h2 style={S.h2}>11. Changes to These Terms</h2>
      <p style={S.p}>We may update these Terms from time to time. Material changes will be notified via the Platform or by email at least 30 days before they take effect. Continued use of XO Capture after the effective date constitutes acceptance of the revised Terms.</p>

      <h2 style={S.h2}>12. Contact</h2>
      <p style={S.p}>For questions about these Terms, contact <a href="mailto:legal@intellagentic.io" style={S.link}>legal@intellagentic.io</a>.</p>

      <LegalFooter />
    </div>
  )
}

function PrivacyPage() {
  const S = LEGAL_STYLES
  return (
    <div style={S.page}>
      <LegalHeader title="Privacy Policy" />

      <h2 style={S.h2}>1. Introduction and Scope</h2>
      <p style={S.p}>Intellagentic Limited (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) operates XO Capture, a web-based capture and intelligence platform. This Privacy Policy explains how we collect, use, store, and protect personal data when you use XO Capture or interact with our services.</p>
      <p style={S.p}>We process personal data in two capacities:</p>
      <ul style={S.ul}>
        <li style={S.li}><strong>As Data Controller:</strong> For account data, billing information, and usage analytics relating to our direct customers and website visitors.</li>
        <li style={S.li}><strong>As Data Processor:</strong> For personal data contained within Captured Content that our clients submit to XO Capture for processing. In this capacity, processing is governed by our Data Processing Addendum (DPA), available on request.</li>
      </ul>

      <h2 style={S.h2}>2. Data We Collect</h2>
      <h3 style={S.h3}>2.1 Account and Contact Data</h3>
      <p style={S.p}>Name, email address, organisation, and role as provided during registration or through Google OAuth sign-in.</p>
      <h3 style={S.h3}>2.2 Captured Content</h3>
      <p style={S.p}>Text, documents, media, and other materials you submit to XO Capture for analysis. This content is stored in AWS S3 within the eu-west-2 (London) region.</p>
      <h3 style={S.h3}>2.3 Usage and Technical Data</h3>
      <p style={S.p}>Browser type, IP address, device information, pages visited, and interaction patterns. We collect this data through server logs and, where applicable, analytics tools.</p>
      <h3 style={S.h3}>2.4 Cookies and Similar Technologies</h3>
      <p style={S.p}>We use strictly necessary cookies for authentication and session management. Where we deploy analytics or performance cookies, we will obtain your consent in accordance with the UK Privacy and Electronic Communications Regulations (PECR). Our Cookie Policy is available at intellagentic.io/cookies.</p>

      <h2 style={S.h2}>3. How We Use Your Data</h2>
      <h3 style={S.h3}>3.1 Service Delivery</h3>
      <p style={S.p}>To operate XO Capture, process your Captured Content through AI models, authenticate your sessions, and deliver analysis results.</p>
      <h3 style={S.h3}>3.2 AI Processing</h3>
      <div style={S.callout}>
        <strong>AI Commitment:</strong> We do not use your private Captured Content to train, fine-tune, or improve any AI models &mdash; whether our own or third-party &mdash; without a separate, explicit opt-in consent. Your data is processed solely to deliver results to you.
      </div>
      <h3 style={S.h3}>3.3 Service Improvement</h3>
      <p style={S.p}>Aggregated, anonymised usage data may be used to improve Platform performance and features. This data cannot be used to identify individual users or reconstruct Captured Content.</p>
      <h3 style={S.h3}>3.4 Legal Bases (UK GDPR)</h3>
      <p style={S.p}>We rely on the following lawful bases: contractual necessity (to deliver the Service), legitimate interests (Platform security, fraud prevention), consent (where required for cookies or marketing), and legal obligation (tax records, regulatory compliance).</p>

      <h2 style={S.h2}>4. Sub-Processors and Third Parties</h2>
      <p style={S.p}>We use the following categories of sub-processors to deliver XO Capture:</p>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Sub-Processor</th><th style={S.th}>Purpose</th><th style={S.th}>Location</th></tr></thead>
        <tbody>
          <tr><td style={S.td}>Amazon Web Services (AWS)</td><td style={S.td}>Infrastructure, storage (S3), compute (Lambda), AI model hosting (Bedrock)</td><td style={S.td}>EU West 2 (London, UK)</td></tr>
          <tr><td style={S.td}>Anthropic (via AWS Bedrock)</td><td style={S.td}>AI model inference (Claude)</td><td style={S.td}>Processing in EU/US per AWS Bedrock routing</td></tr>
          <tr><td style={S.td}>Google (OAuth)</td><td style={S.td}>User authentication</td><td style={S.td}>Global</td></tr>
        </tbody>
      </table>
      <p style={S.p}>A complete, current list of sub-processors is maintained at intellagentic.io/sub-processors and updated with at least 14 days&rsquo; prior notice of any material changes.</p>

      <h2 style={S.h2}>5. International Data Transfers</h2>
      <p style={S.p}>Primary data storage is in the United Kingdom (AWS eu-west-2, London). Where processing requires data to transit outside the UK (for example, AI model inference routed through AWS regions), we rely on the UK International Data Transfer Agreement (IDTA), AWS&rsquo;s data processing addendum, or another approved transfer mechanism under UK GDPR.</p>

      <h2 style={S.h2}>6. Data Security</h2>
      <ul style={S.ul}>
        <li style={S.li}><strong>Encryption at Rest:</strong> AES-256 server-side encryption for all stored content in AWS S3.</li>
        <li style={S.li}><strong>Encryption in Transit:</strong> All connections enforced over HTTPS using TLS 1.3.</li>
        <li style={S.li}><strong>Access Controls:</strong> Role-based access with Google OAuth, three-tier permission model (Owner, Admin, User).</li>
        <li style={S.li}><strong>Infrastructure:</strong> Virtual Private Cloud (VPC) isolation, automated threat detection, and Web Application Firewall (WAF) protection.</li>
      </ul>
      <p style={S.p}>For full details of our technical security controls, see our <a href="/security" style={S.link}>Security and Compliance</a> page.</p>

      <h2 style={S.h2}>7. Data Breach Notification</h2>
      <p style={S.p}>In the event of a personal data breach, we will notify the UK Information Commissioner&rsquo;s Office (ICO) within 72 hours of becoming aware of a qualifying breach, as required by UK GDPR Article 33. Where the breach is likely to result in a high risk to your rights and freedoms, we will notify affected individuals without undue delay.</p>

      <h2 style={S.h2}>8. Your Rights</h2>
      <h3 style={S.h3}>8.1 UK / EEA Residents</h3>
      <p style={S.p}>Under UK GDPR, you have the right to: access your personal data, request rectification or erasure, restrict or object to processing, data portability, and lodge a complaint with the ICO (ico.org.uk).</p>
      <h3 style={S.h3}>8.2 US Residents (California and Other States)</h3>
      <p style={S.p}>Under the CCPA/CPRA and similar state privacy laws, you have the right to: know what personal information we collect, request deletion, opt out of the sale or sharing of personal information, and opt out of targeted advertising. We do not sell personal information. To exercise your rights, contact <a href="mailto:privacy@intellagentic.io" style={S.link}>privacy@intellagentic.io</a>.</p>

      <h2 style={S.h2}>9. Data Retention</h2>
      <ul style={S.ul}>
        <li style={S.li}><strong>Account Data:</strong> Retained for the duration of your subscription plus 7 years for UK tax and legal compliance.</li>
        <li style={S.li}><strong>Captured Content:</strong> Retained for the duration of your subscription. Upon termination, you may request export within 30 days, after which content may be deleted.</li>
        <li style={S.li}><strong>Technical Logs:</strong> Retained for up to 12 months, then automatically purged.</li>
        <li style={S.li}><strong>AI Processing Logs:</strong> Retained for up to 90 days for debugging and service quality.</li>
      </ul>

      <h2 style={S.h2}>10. Children</h2>
      <p style={S.p}>XO Capture is not directed at individuals under the age of 18. We do not knowingly collect personal data from children. If you believe a child has provided us with personal data, please contact us and we will take steps to delete it.</p>

      <h2 style={S.h2}>11. Changes to This Policy</h2>
      <p style={S.p}>We may update this Privacy Policy from time to time. Material changes will be communicated via the Platform or by email. The &ldquo;Last Updated&rdquo; date at the top of this document indicates the most recent revision.</p>

      <h2 style={S.h2}>12. Contact</h2>
      <ul style={S.ul}>
        <li style={S.li}><strong>General / Legal:</strong> <a href="mailto:legal@intellagentic.io" style={S.link}>legal@intellagentic.io</a></li>
        <li style={S.li}><strong>Privacy / Data Subject Requests:</strong> <a href="mailto:privacy@intellagentic.io" style={S.link}>privacy@intellagentic.io</a></li>
      </ul>

      <LegalFooter />
    </div>
  )
}

function SecurityPage() {
  const S = LEGAL_STYLES
  return (
    <div style={S.page}>
      <LegalHeader title="Security and Compliance" />

      <div style={S.callout}>
        XO Capture is built on AWS infrastructure in the eu-west-2 (London) region. The certifications listed below are held by AWS as our infrastructure provider. Intellagentic Limited is not independently ISO or SOC certified at this time.
      </div>

      <h2 style={S.h2}>1. Infrastructure Certifications (AWS)</h2>
      <p style={S.p}>XO Capture runs on AWS infrastructure that independently maintains the following certifications. These cover the physical data centres, network, and managed services (S3, Lambda, Bedrock, CloudFront, RDS) that underpin XO Capture:</p>
      <table style={S.table}>
        <thead><tr><th style={S.th}>Certification</th><th style={S.th}>Scope</th><th style={S.th}>Relevance</th></tr></thead>
        <tbody>
          <tr><td style={S.td}>ISO/IEC 27001:2022</td><td style={S.td}>Information Security Management System</td><td style={S.td}>Core security standard for enterprise procurement</td></tr>
          <tr><td style={S.td}>SOC 2 Type II</td><td style={S.td}>Security, availability, and confidentiality controls</td><td style={S.td}>Standard assurance requirement for US enterprise</td></tr>
          <tr><td style={S.td}>ISO/IEC 27701:2019</td><td style={S.td}>Privacy Information Management (PIMS)</td><td style={S.td}>Extension of 27001 covering GDPR-aligned privacy</td></tr>
          <tr><td style={S.td}>ISO/IEC 42001:2023</td><td style={S.td}>AI Management System</td><td style={S.td}>Governance framework for responsible AI deployment</td></tr>
          <tr><td style={S.td}>ISO/IEC 27018:2019</td><td style={S.td}>Protection of PII in public cloud</td><td style={S.td}>Cloud-specific personal data controls</td></tr>
          <tr><td style={S.td}>CSA STAR Level 2</td><td style={S.td}>Cloud Controls Matrix attestation</td><td style={S.td}>Cloud security industry benchmark</td></tr>
        </tbody>
      </table>

      <h2 style={S.h2}>2. Technical Security Controls</h2>
      <h3 style={S.h3}>2.1 Encryption</h3>
      <ul style={S.ul}>
        <li style={S.li}><strong>In Transit:</strong> All connections are enforced over HTTPS using TLS 1.3. No plaintext HTTP is accepted; all requests are redirected to HTTPS via CloudFront and API Gateway.</li>
        <li style={S.li}><strong>At Rest:</strong> All user-uploaded content and Captured Content is encrypted using AES-256 server-side encryption (SSE-S3) within the eu-west-2 (London) region.</li>
      </ul>
      <h3 style={S.h3}>2.2 Network and Access</h3>
      <ul style={S.ul}>
        <li style={S.li}><strong>VPC Isolation:</strong> Backend services run within a Virtual Private Cloud with private subnets and restricted security groups.</li>
        <li style={S.li}><strong>WAF Protection:</strong> AWS Web Application Firewall guards against common exploits (SQL injection, XSS, request flooding).</li>
        <li style={S.li}><strong>Threat Detection:</strong> AWS GuardDuty provides automated threat detection across compute, storage, and network layers.</li>
        <li style={S.li}><strong>Access Control:</strong> Three-tier role-based access (Owner, Admin, User) with Google OAuth authentication. No shared credentials.</li>
      </ul>
      <h3 style={S.h3}>2.3 Logging and Monitoring</h3>
      <ul style={S.ul}>
        <li style={S.li}><strong>Application Logs:</strong> CloudWatch with 90-day retention.</li>
        <li style={S.li}><strong>AI Model Logs:</strong> Bedrock model invocation logging to dedicated log group with restricted access.</li>
        <li style={S.li}><strong>Cost Controls:</strong> Monthly budget alerts configured per AWS service.</li>
      </ul>

      <h2 style={S.h2}>3. AI Processing</h2>
      <p style={S.p}>XO Capture uses AI models hosted on AWS Bedrock for analysis and intelligence generation:</p>
      <ul style={S.ul}>
        <li style={S.li}><strong>Model Provider:</strong> Anthropic (Claude), accessed via the AWS Bedrock managed service.</li>
        <li style={S.li}><strong>Data Isolation:</strong> Bedrock does not store or use customer data for model training. Your prompts and completions are not retained by the model provider.</li>
        <li style={S.li}><strong>Regional Processing:</strong> AI inference is routed through eu-west-2 where available. Where a specific model is not yet available in eu-west-2, requests may be routed to other AWS regions under AWS&rsquo;s data processing terms.</li>
      </ul>

      <h2 style={S.h2}>4. Compliance Frameworks</h2>
      <h3 style={S.h3}>4.1 United Kingdom / European Union</h3>
      <ul style={S.ul}>
        <li style={S.li}><strong>UK GDPR:</strong> Full alignment with the UK General Data Protection Regulation. Data residency in the UK. 72-hour breach notification to the ICO.</li>
        <li style={S.li}><strong>Data Protection Act 2018:</strong> Compliance with supplementary UK data protection legislation.</li>
        <li style={S.li}><strong>PECR:</strong> Cookie consent mechanisms in line with the Privacy and Electronic Communications Regulations.</li>
      </ul>
      <h3 style={S.h3}>4.2 United States</h3>
      <ul style={S.ul}>
        <li style={S.li}><strong>CCPA/CPRA:</strong> Designed for compliance with the California Consumer Privacy Act and California Privacy Rights Act. We do not sell personal information.</li>
        <li style={S.li}><strong>State Privacy Laws:</strong> Architecture supports compliance with emerging state privacy regulations (Virginia CDPA, Colorado CPA, etc.).</li>
      </ul>
      <h3 style={S.h3}>4.3 Sector-Specific (Where Applicable)</h3>
      <ul style={S.ul}>
        <li style={S.li}><strong>NHS DSPT/DTAC:</strong> Architecture designed with NHS Data Security and Protection Toolkit and Digital Technology Assessment Criteria requirements in mind for healthcare deployments.</li>
        <li style={S.li}><strong>HIPAA:</strong> BAA-eligible AWS services used where US healthcare data processing applies.</li>
      </ul>

      <h2 style={S.h2}>5. Data Residency</h2>
      <p style={S.p}>All primary data storage (S3 buckets, RDS databases) is physically located in the United Kingdom (AWS eu-west-2, London). Content does not leave the UK region for storage purposes. Where transient processing (such as AI inference) may involve other AWS regions, this is governed by AWS&rsquo;s data processing addendum and UK-approved transfer mechanisms.</p>

      <h2 style={S.h2}>6. Incident Response</h2>
      <p style={S.p}>Intellagentic Limited maintains an incident response procedure that includes: identification and containment within 4 hours of detection, ICO notification within 72 hours for qualifying breaches, affected-party notification without undue delay where high risk is identified, and post-incident review with corrective actions documented.</p>

      <h2 style={S.h2}>7. Contact</h2>
      <ul style={S.ul}>
        <li style={S.li}><strong>Security Inquiries:</strong> <a href="mailto:security@intellagentic.io" style={S.link}>security@intellagentic.io</a></li>
        <li style={S.li}><strong>DPA / Compliance Requests:</strong> <a href="mailto:legal@intellagentic.io" style={S.link}>legal@intellagentic.io</a></li>
      </ul>

      <LegalFooter />
    </div>
  )
}


export default function App() {
  // Intercept /invite path — completely independent, no auth
  if (window.location.pathname === '/invite') {
    return <InvitePage />
  }
  if (window.location.pathname === '/accept-invite') {
    return <AcceptInvitePage onLogin={(userData, token) => {
      sessionStorage.setItem('xo-token', token)
      sessionStorage.setItem('xo-user', JSON.stringify(userData))
      window.location.href = '/'
    }} />
  }

  // Auth state -- restored from sessionStorage synchronously
  const [initialAuth] = useState(getInitialAuth)
  const [isLoggedIn, setIsLoggedIn] = useState(initialAuth.loggedIn)
  const [user, setUser] = useState(initialAuth.user)
  const [authToken, setAuthToken] = useState(initialAuth.token)

  // Model preference state
  const [preferredModel, setPreferredModel] = useState(
    initialAuth.user?.preferred_model || 'claude-opus-4-6'
  )

  // Admin / Partner state
  const [isAdmin, setIsAdmin] = useState(initialAuth.user?.is_admin || false)
  const [isAccount, setIsAccount] = useState(initialAuth.user?.is_account || false)

  // Magic token URL handling — loading state
  const [magicTokenLoading, setMagicTokenLoading] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return !!params.get('token')
  })

  // HubSpot OAuth callback handling
  const [hubspotCallbackLoading, setHubspotCallbackLoading] = useState(() => {
    return window.location.pathname === '/oauth/callback' && !!new URLSearchParams(window.location.search).get('code')
  })
  const [hubspotCallbackResult, setHubspotCallbackResult] = useState(null) // { success, message }

  const handleLogin = (userData, token) => {
    setUser(userData)
    setAuthToken(token)
    setIsLoggedIn(true)
    const admin = !!userData.is_admin
    const partner = !!userData.is_account
    setIsAdmin(admin)
    setIsAccount(partner)
    if (userData.preferred_model) setPreferredModel(userData.preferred_model)
    const hasClientList = admin || partner || ['account_user', 'account_admin', 'contributor', 'client_contact'].includes(userData.account_role)
    if (hasClientList) {
      setCurrentScreen('dashboard')
      setInWorkspace(false)
    } else if (userData.is_client && userData.client_id) {
      setClientId(userData.client_id)
      sessionStorage.setItem('xo-client-id', userData.client_id)
      setInWorkspace(true)
      setCurrentScreen('upload')
    }
  }

  const saveModelPreference = async (model) => {
    setPreferredModel(model)
    try {
      const res = await fetch(`${API_BASE}/auth/preferences`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ preferred_model: model })
      })
      const data = await res.json();
      if(res.ok){
        let user = sessionStorage.getItem('xo-user');
        user = JSON.parse(user);
        user.preferred_model=model;
        sessionStorage.setItem('xo-user', JSON.stringify(user));
      }
    } catch (err) {
      console.error('Failed to save model preference:', err)
    }
  }

  const handleLogout = () => {
    setUser(null)
    setAuthToken(null)
    setIsLoggedIn(false)
    setIsAdmin(false)
    setIsAccount(false)
    setClientId(null)
    sessionStorage.removeItem('xo-token')
    sessionStorage.removeItem('xo-user')
    sessionStorage.removeItem('xo-client-id')
    setCurrentScreen('upload')
  }

  const [currentScreen, setCurrentScreen] = useState(() => {
    return (initialAuth.user?.is_admin || initialAuth.user?.is_account || ['account_user', 'account_admin', 'contributor', 'client_contact'].includes(initialAuth.user?.account_role)) ? 'dashboard' : 'upload'
  }) // dashboard | upload | enrich | results | skills | configuration
  const [inWorkspace, setInWorkspace] = useState(() => {
    return !(initialAuth.user?.is_admin || initialAuth.user?.is_account)
  })
  const [showModal, setShowModal] = useState(false)
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(() => {
    const saved = sessionStorage.getItem('xo-sidebar-pinned')
    return saved !== null ? saved === 'true' : window.innerWidth > 768
  })
  const [sidebarHover, setSidebarHover] = useState(false)
  const sidebarExpanded = sidebarPinned || sidebarHover
  const [clientId, setClientId] = useState(() => sessionStorage.getItem('xo-client-id') || null)
  // PR 4 hotfix: SF state lifted from ConfigurationScreen to App so the
  // sidebar SF Conflicts link can reference salesforceUnresolvedConflicts
  // at the top-level render. ConfigurationScreen receives these as props.
  const [salesforceConnected, setSalesforceConnected] = useState(false)
  const [salesforceInstanceUrl, setSalesforceInstanceUrl] = useState(null)
  const [salesforceError, setSalesforceError] = useState(null)
  const [salesforceLastPullAt, setSalesforceLastPullAt] = useState(null)
  const [salesforceUnresolvedConflicts, setSalesforceUnresolvedConflicts] = useState(0)
  const [salesforceConnecting, setSalesforceConnecting] = useState(false)
  const [salesforcePulling, setSalesforcePulling] = useState(false)
  const [salesforceStatusLoaded, setSalesforceStatusLoaded] = useState(false)
  const [salesforceSyncResult, setSalesforceSyncResult] = useState(null)
  const [companyData, setCompanyData] = useState({
    name: '',
    website: '',
    contacts: [],
    addresses: [],
    industry: '',
    description: '',
    painPoint: '',
    futurePlans: '',
    painPoints: [],
    logoUrl: null,
    iconUrl: null,
    existingApps:'',
    ndaSigned:false,
    ndaSignedAt:''
  })

  // Engagements state
  const [engagements, setEngagements] = useState([])
  const [activeEngagement, setActiveEngagement] = useState(null)

  // Team users state (for cross-referencing photos)
  const [teamUsers, setTeamUsers] = useState([])

  // Partners state (for admin partner management & dropdowns)
  const [accounts, setAccounts] = useState([])

  // Theme state - persisted to sessionStorage
  const [theme, setTheme] = useState(() => {
    return sessionStorage.getItem('xo-theme') || 'light'
  })

  useEffect(() => {
    document.body.setAttribute('data-theme', theme)
    sessionStorage.setItem('xo-theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

  // Persist clientId to sessionStorage
  useEffect(() => {
    if (clientId) sessionStorage.setItem('xo-client-id', clientId)
  }, [clientId])

  // Magic token URL handling — validate on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const magicToken = params.get('token')
    if (!magicToken) return

    const validateToken = async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: magicToken })
        })
        const data = await res.json()
        if (res.ok && data.token) {
          sessionStorage.setItem('xo-token', data.token)
          sessionStorage.setItem('xo-user', JSON.stringify(data.user))
          setUser(data.user)
          setAuthToken(data.token)
          setIsLoggedIn(true)
          setIsAdmin(false)
          setIsAccount(false)
          if (data.user.client_id) {
            setClientId(data.user.client_id)
            sessionStorage.setItem('xo-client-id', data.user.client_id)
          }
          setCurrentScreen('upload')
        }
      } catch (err) {
        console.error('Magic token validation failed:', err)
      }
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
      setMagicTokenLoading(false)
    }
    validateToken()
  }, [])

  // HubSpot OAuth callback — handle /oauth/callback?code=...
  useEffect(() => {
    if (window.location.pathname !== '/oauth/callback') return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const error = params.get('error')

    if (error) {
      setHubspotCallbackResult({ success: false, message: `HubSpot authorization denied: ${error}` })
      setHubspotCallbackLoading(false)
      return
    }
    if (!code) return

    const exchangeCode = async () => {
      try {
        const res = await fetch(`${API_BASE}/hubspot/callback?code=${encodeURIComponent(code)}`, {
          headers: { 'Content-Type': 'application/json' }
        })
        const data = await res.json()
        if (res.ok) {
          setHubspotCallbackResult({ success: true, message: 'HubSpot connected successfully!' })
          // Redirect to main app after 3 seconds
          setTimeout(() => {
            window.location.href = window.location.origin
          }, 3000)
        } else {
          setHubspotCallbackResult({ success: false, message: data.error || 'Failed to connect HubSpot' })
        }
      } catch (err) {
        setHubspotCallbackResult({ success: false, message: `Connection failed: ${err.message}` })
      }
      setHubspotCallbackLoading(false)
    }
    exchangeCode()
  }, [])

  // Custom buttons state - synced with PostgreSQL via API
  const [configButtons, setConfigButtons] = useState(DEFAULT_BUTTONS)
  const [systemButtons, setSystemButtons] = useState([])
  const [buttonsLoaded, setButtonsLoaded] = useState(false)

  // Fetch buttons, client data, and accounts from API after login
  useEffect(() => {
    if (isLoggedIn && !buttonsLoaded) {
      fetchButtons()
    }
    if (isLoggedIn) {
      fetchExistingClient()
      if (isAdmin) {
        fetchPartners()
        fetch(`${API_BASE}/auth/invite`, { headers: getAuthHeaders() })
          .then(res => res.ok ? res.json() : null)
          .then(data => { if (data) setTeamUsers(data.users || []) })
          .catch(() => {})
      }
      // PR 4 hotfix: fetch SF status at the App level so the sidebar
      // "SF Conflicts (N)" link has its count ready before any screen
      // mounts. Only relevant for users with an account_id — the backend
      // 400s otherwise. Errors are swallowed (status remains disconnected,
      // count remains 0).
      if (user && user.account_id != null) {
        fetch(`${API_BASE}/salesforce/status`, { headers: getAuthHeaders() })
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) {
              setSalesforceConnected(!!data.connected)
              setSalesforceInstanceUrl(data.instance_url || null)
              setSalesforceError(data.error || null)
              setSalesforceLastPullAt(data.last_pull_at || null)
              setSalesforceUnresolvedConflicts(data.unresolved_conflicts || 0)
            }
          })
          .catch(() => {})
          .finally(() => setSalesforceStatusLoaded(true))
      } else {
        setSalesforceStatusLoaded(true)
      }
    }
  }, [isLoggedIn])

  const fetchPartners = async () => {
    try {
      const res = await fetch(`${API_BASE}/accounts`, { headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        setAccounts(data.accounts || [])
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err)
    }
  }

  const fetchButtons = async () => {
    try {
      // Fetch system buttons
      const sysRes = await fetch(`${API_BASE}/buttons?scope=system`, { headers: getAuthHeaders() })
      if (sysRes.ok) {
        const sysData = await sysRes.json()
        setSystemButtons(sysData.buttons || [])
      }
      // Fetch client buttons if in workspace
      if (clientId) {
        const cliRes = await fetch(`${API_BASE}/buttons?scope=client&client_id=${clientId}`, { headers: getAuthHeaders() })
        if (cliRes.ok) {
          const cliData = await cliRes.json()
          if (cliData.buttons && cliData.buttons.length > 0) {
            setConfigButtons(cliData.buttons)
          }
        }
      } else {
        // Legacy: fetch user buttons
        const response = await fetch(`${API_BASE}/buttons`, { headers: getAuthHeaders() })
        if (response.ok) {
          const data = await response.json()
          if (data.buttons && data.buttons.length > 0) {
            setConfigButtons(data.buttons)
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch buttons:', err)
    }
    setButtonsLoaded(true)
  }

  const fetchExistingClient = async () => {
    try {
      const url = clientId
        ? `${API_BASE}/clients?client_id=${clientId}`
        : `${API_BASE}/clients`
      const response = await fetch(url, { headers: getAuthHeaders() })
      let data = null
      if (response.ok) {
        data = await response.json()
        // Build contacts array: prefer API contacts, fallback to legacy flat fields
        let contacts = (data.contacts || []).map(migrateContact)
        if (!contacts.length && (data.contactName || data.contactEmail)) {
          const legacyName = data.contactName || ''
          const spaceIdx = legacyName.indexOf(' ')
          contacts = [{ firstName: spaceIdx > 0 ? legacyName.substring(0, spaceIdx) : legacyName, lastName: spaceIdx > 0 ? legacyName.substring(spaceIdx + 1) : '', title: data.contactTitle || '', email: data.contactEmail || '', phone: data.contactPhone || '', linkedin: data.contactLinkedIn || '' }]
        }
        setCompanyData({
          name: data.company_name || '',
          ndaSigned: data.ndaSigned || false,
          ndaSignedAt: data.ndaSignedAt || '',
          existingApps: data.existingApps || '',
          website: data.website || '',
          company_linkedin: data.company_linkedin || '',
          contacts,
          addresses: data.addresses || [],
          industry: data.industry || '',
          description: data.description || '',
          painPoint: data.painPoint || '',
          futurePlans: data.futurePlans || '',
          painPoints: data.painPoints || [],
          logoUrl: data.logo_url || null,
          iconUrl: data.icon_url || null,
          account_id: data.account_id || null,
          intellagentic_lead: data.intellagentic_lead || false
        })
        if (data.client_id && !clientId) {
          setClientId(data.client_id)
        }
      }
      // Fetch engagements for this client on page load
      const cid = clientId || data?.client_id
      if (cid) {
        try {
          const engRes = await fetch(`${API_BASE}/engagements?client_id=${cid}`, { headers: getAuthHeaders() })
          if (engRes.ok) {
            const engData = await engRes.json()
            const fetchedEngagements = engData.engagements || []
            setEngagements(fetchedEngagements)
            // Restore saved engagement selection
            const savedEngId = sessionStorage.getItem('xo-engagement-' + cid)
            if (savedEngId) {
              const match = fetchedEngagements.find(e => e.id === savedEngId)
              if (match) setActiveEngagement(match)
            } else if (fetchedEngagements.length === 1) {
              setActiveEngagement(fetchedEngagements[0])
            }
          }
        } catch (_) {}
      }
    } catch (err) {
      console.error('Failed to fetch existing client:', err)
    }
  }

  const saveButtons = async (newButtons, extraDeletedIds) => {
    setConfigButtons(newButtons)
    try {
      const payload = clientId
        ? { client_id: clientId, buttons: newButtons, deleted_ids: extraDeletedIds || [] }
        : { buttons: newButtons, deleted_ids: extraDeletedIds || [] }
      await fetch(`${API_BASE}/buttons/sync`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload)
      })
    } catch (err) {
      console.error('Failed to save buttons:', err)
    }
  }

  const saveSystemButtons = async (newButtons, extraDeletedIds) => {
    setSystemButtons(newButtons)
    try {
      const allDeleted = [...(extraDeletedIds || [])]
      await fetch(`${API_BASE}/buttons/sync`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ scope: 'system', buttons: newButtons, deleted_ids: allDeleted })
      })
    } catch (err) {
      console.error('Failed to save system buttons:', err)
    }
  }

  // Re-fetch client buttons when entering a workspace
  useEffect(() => {
    if (isLoggedIn && clientId) {
      (async () => {
        try {
          const cliRes = await fetch(`${API_BASE}/buttons?scope=client&client_id=${clientId}`, { headers: getAuthHeaders() })
          if (cliRes.ok) {
            const cliData = await cliRes.json()
            setConfigButtons(cliData.buttons && cliData.buttons.length > 0 ? cliData.buttons : DEFAULT_BUTTONS)
          }
        } catch (err) {
          console.error('Failed to fetch client buttons:', err)
        }
      })()
    }
  }, [clientId])

  const toggleSidebarPin = () => {
    setSidebarPinned(prev => {
      const next = !prev
      sessionStorage.setItem('xo-sidebar-pinned', String(next))
      return next
    })
    setSidebarHover(false)
  }

  const navigateTo = (screen) => {
    setCurrentScreen(screen)
    // On mobile, collapse sidebar after navigation
    if (window.innerWidth <= 768) {
      setSidebarPinned(false)
      sessionStorage.setItem('xo-sidebar-pinned', 'false')
      setSidebarHover(false)
    }
  }

  // Create or update client when company info is saved
  const handleClientCreate = async (data) => {
    try {
      if (clientId) {
        // Update existing client
        const response = await fetch(`${API_BASE}/clients`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            client_id: clientId,
            company_name: data.name,
            website: data.website,
            company_linkedin: data.company_linkedin || '',
            contacts: data.contacts || [],
            addresses: data.addresses || [],
            industry: data.industry,
            description: data.description,
            painPoint: data.painPoint,
            futurePlans: data.futurePlans || '',
            painPoints: data.painPoints || [],
            account_id: data.account_id,
            intellagentic_lead: data.intellagentic_lead,
            ndaSigned:data.ndaSigned,
            existingApps: data.existingApps
          })
        })
        if (response.ok) {
          console.log('Client updated:', clientId)
          setCompanyData(prev => ({
            ...prev,
            updated_at: new Date().toISOString(),
            updated_by: user?.name || user?.email || ''
          }))
        }
      } else {
        // Create new client
        const response = await fetch(`${API_BASE}/clients`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            company_name: data.name,
            website: data.website,
            company_linkedin: data.company_linkedin || '',
            contacts: data.contacts || [],
            addresses: data.addresses || [],
            industry: data.industry,
            description: data.description,
            painPoint: data.painPoint,
            futurePlans: data.futurePlans || '',
            painPoints: data.painPoints || [],
            account_id: data.account_id,
            intellagentic_lead: data.intellagentic_lead,
            ndaSigned:data.ndaSigned,
            existingApps: data.existingApps
          })
        })
        if (response.ok) {
          const { client_id } = await response.json()
          setClientId(client_id)
          console.log('Client created on company save:', client_id)
        }
      }
    } catch (err) {
      console.error('Failed to save client:', err)
    }
  }

  // Dashboard: select an existing client and enter workspace
  const handleSelectClient = async (client) => {
    setInWorkspace(true)
    setClientId(client.client_id)
    sessionStorage.setItem('xo-client-id', client.client_id)
    // Fetch full company data
    try {
      const res = await fetch(`${API_BASE}/clients?client_id=${client.client_id}`, { headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        let contacts = (data.contacts || []).map(migrateContact)
        if (!contacts.length && (data.contactName || data.contactEmail)) {
          const legacyName = data.contactName || ''
          const spaceIdx = legacyName.indexOf(' ')
          contacts = [{ firstName: spaceIdx > 0 ? legacyName.substring(0, spaceIdx) : legacyName, lastName: spaceIdx > 0 ? legacyName.substring(spaceIdx + 1) : '', title: data.contactTitle || '', email: data.contactEmail || '', phone: data.contactPhone || '', linkedin: data.contactLinkedIn || '' }]
        }
        setCompanyData({
          name: data.company_name || '',
          ndaSigned: data.ndaSigned || false,
          ndaSignedAt: data.ndaSignedAt || '',
          existingApps: data.existingApps || '',
          website: data.website || '',
          company_linkedin: data.company_linkedin || '',
          contacts,
          addresses: data.addresses || [],
          industry: data.industry || '',
          description: data.description || '',
          painPoint: data.painPoint || '',
          futurePlans: data.futurePlans || '',
          painPoints: data.painPoints || [],
          logoUrl: data.logo_url || null,
          iconUrl: data.icon_url || null,
          account_id: data.account_id || null,
          intellagentic_lead: data.intellagentic_lead || false,
          updated_by:data.updated_by,
          updated_at:data.updated_at
        })
      }
    } catch (err) {
      console.error('Failed to fetch client:', err)
    }
    // Fetch engagements for this client
    let fetchedEngagements = []
    try {
      const engRes = await fetch(`${API_BASE}/engagements?client_id=${client.client_id}`, { headers: getAuthHeaders() })
      if (engRes.ok) { const engData = await engRes.json(); fetchedEngagements = engData.engagements || [] }
    } catch (e) {}
    setEngagements(fetchedEngagements)
    // Restore saved engagement or auto-select if exactly one
    const savedEngId = sessionStorage.getItem('xo-engagement-' + client.client_id)
    if (savedEngId) {
      const match = fetchedEngagements.find(e => e.id === savedEngId)
      setActiveEngagement(match || (fetchedEngagements.length === 1 ? fetchedEngagements[0] : null))
    } else {
      setActiveEngagement(fetchedEngagements.length === 1 ? fetchedEngagements[0] : null)
    }
    setCurrentScreen('upload')
  }

  // Dashboard: create new client
  const handleCreateNewClient = () => {
    setClientId(null)
    sessionStorage.removeItem('xo-client-id')
    setCompanyData({ name: '', website: '', company_linkedin: '', contacts: [], addresses: [], industry: '', description: '', painPoint: '', futurePlans: '', painPoints: [], logoUrl: null, iconUrl: null, account_id: null, intellagentic_lead: false })

    setShowCompanyModal(true)
  }

  // After company modal save, navigate to workspace if coming from dashboard
  const handleClientCreateFromDashboard = async (data) => {
    await handleClientCreate(data)
    if (currentScreen === 'dashboard') {
      setCurrentScreen('upload')
    }
  }

  // Magic token loading gate
  // Legal pages — public, no auth required
  const _path = window.location.pathname
  if (_path === '/terms') return <TermsPage />
  if (_path === '/privacy') return <PrivacyPage />
  if (_path === '/security') return <SecurityPage />

  // HubSpot OAuth callback screen
  if (hubspotCallbackLoading || hubspotCallbackResult) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary, #fff)' }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: '2rem' }}>
          {hubspotCallbackLoading && !hubspotCallbackResult && (
            <>
              <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: '#dc2626', margin: '0 auto 1rem' }} />
              <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.9375rem' }}>Connecting to HubSpot...</p>
            </>
          )}
          {hubspotCallbackResult?.success && (
            <>
              <CheckCircle size={48} style={{ color: '#22c55e', margin: '0 auto 1rem' }} />
              <h2 style={{ color: 'var(--text-primary, #111)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>{hubspotCallbackResult.message}</h2>
              <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.85rem' }}>Redirecting to dashboard...</p>
            </>
          )}
          {hubspotCallbackResult && !hubspotCallbackResult.success && (
            <>
              <AlertCircle size={48} style={{ color: '#dc2626', margin: '0 auto 1rem' }} />
              <h2 style={{ color: 'var(--text-primary, #111)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>Connection Failed</h2>
              <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.85rem', marginBottom: '1rem' }}>{hubspotCallbackResult.message}</p>
              <button
                onClick={() => { window.location.href = window.location.origin }}
                style={{ padding: '0.5rem 1.5rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.85rem', cursor: 'pointer' }}
              >Back to Dashboard</button>
            </>
          )}
        </div>
      </div>
    )
  }

  if (magicTokenLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg-primary, #fff)' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: '#dc2626', margin: '0 auto 1rem' }} />
          <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.9375rem' }}>Validating access...</p>
        </div>
      </div>
    )
  }

  // Auth gate
  if (!isLoggedIn) {
    return <LoginScreen onLogin={handleLogin} />
  }

  const sidebarVisualWidth = sidebarExpanded ? 220 : 56
  const contentOffset = sidebarPinned ? 220 : 56

  // Sidebar nav item helper
  const SidebarItem = ({ screen, icon: Icon, label, onClick, active, color }) => {
    const isActive = active !== undefined ? active : currentScreen === screen
    const itemColor = color || (isActive ? '#dc2626' : '#ffffff')
    return (
      <button
        onClick={onClick || (() => screen && navigateTo(screen))}
        title={!sidebarExpanded ? label : undefined}
        style={{
          width: '100%',
          background: isActive ? 'rgba(220, 38, 38, 0.2)' : 'transparent',
          border: 'none',
          borderLeft: isActive ? '3px solid #dc2626' : '3px solid transparent',
          color: itemColor,
          padding: sidebarExpanded ? '0.6rem 0.875rem' : '0.6rem 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarExpanded ? 'flex-start' : 'center',
          gap: '0.6rem',
          cursor: 'pointer',
          fontSize: '0.8rem',
          fontWeight: 500,
          transition: 'all 0.2s',
          whiteSpace: 'nowrap',
          overflow: 'hidden'
        }}
      >
        <Icon size={17} style={{ flexShrink: 0 }} />
        {sidebarExpanded && <span>{label}</span>}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', overflowX: 'hidden', width: '100%' }}>
      {/* Persistent Sidebar */}
      <aside
        onMouseEnter={() => { if (!sidebarPinned) setSidebarHover(true) }}
        onMouseLeave={() => setSidebarHover(false)}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          // 40px == .app-footer rendered height (10px padding + 20px logo + 10px padding).
          // Stops the sidebar above the full-width footer so the footer can span
          // the entire viewport bottom edge.
          bottom: 40,
          width: `${sidebarVisualWidth}px`,
          background: '#0C1A2A',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s ease',
          overflow: 'hidden',
          boxShadow: sidebarHover && !sidebarPinned ? '4px 0 16px rgba(0, 0, 0, 0.3)' : '2px 0 8px rgba(0, 0, 0, 0.15)'
        }}
      >
        {/* Sidebar Header */}
        <div style={{
          padding: sidebarExpanded ? '0.75rem 0.875rem' : '0.75rem 0',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarExpanded ? 'space-between' : 'center',
          minHeight: '54px'
        }}>
          {sidebarExpanded ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0, border: '1.5px solid rgba(255,255,255,0.3)' }}>
                  {user?.photo_url ? (
                    <img src={user.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.7rem', fontWeight: 600 }}>{(user?.name || '?')[0].toUpperCase()}</span>}
                </div>
                <div style={{ minWidth: 0 }}>
                <span style={{ color: '#E8E1CF', fontWeight: 600, fontSize: '0.8rem', display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.name || 'Menu'}</span>
                {isAdmin && <span style={{ display: 'inline-block', fontSize: '0.55rem', fontWeight: 700, color: '#fff', background: '#CC0000', padding: '0.05rem 0.35rem', borderRadius: 4, letterSpacing: '0.04em', marginTop: '0.1rem' }}>XO ADMIN</span>}
                {user?.email && <span style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.65rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{user.email}</span>}
                </div>
              </div>
              <button
                onClick={toggleSidebarPin}
                title={sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar open'}
                style={{ background: 'none', border: 'none', color: sidebarPinned ? '#dc2626' : 'rgba(255, 255, 255, 0.7)', cursor: 'pointer', padding: '0.65rem', flexShrink: 0 }}
              >
                {sidebarPinned ? <ChevronLeft size={18} /> : <Lock size={14} />}
              </button>
            </>
          ) : (
            <button
              onClick={toggleSidebarPin}
              title="Pin sidebar open"
              style={{ background: 'none', border: 'none', color: 'rgba(255, 255, 255, 0.7)', cursor: 'pointer', padding: '0.60rem' }}
            >
              <Menu size={20} />
            </button>
          )}
        </div>

        {/* Menu Items */}
        <nav style={{ flex: 1, padding: '0.5rem 0', overflowY: 'auto', overflowX: 'hidden' }}>
          {(isAdmin || isAccount || ['account_user', 'account_admin', 'contributor', 'client_contact'].includes(user?.account_role)) && (
            <>
              <SidebarItem
                screen="dashboard"
                icon={Building2}
                label={isAdmin ? 'All Clients' : 'My Clients'}
                onClick={() => { setInWorkspace(false); navigateTo('dashboard') }}
                active={currentScreen === 'dashboard'}
              />
              <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: sidebarExpanded ? '0.35rem 0.875rem' : '0.35rem 0.5rem' }} />
            </>
          )}
          {[
            { screen: 'upload', icon: Home, label: 'Welcome' },
            ...(user?.account_role !== 'client_contact' ? [{ screen: 'sources', icon: FolderOpen, label: 'Your Data' }] : []),
            ...(!['contributor', 'client_contact'].includes(user?.account_role) ? [{ screen: 'enrich', icon: Sparkles, label: 'Enrich' }] : []),
            { screen: 'results', icon: FileText, label: 'Results' },
            ...(!['contributor', 'client_contact'].includes(user?.account_role) ? [{ screen: 'skills', icon: Database, label: 'Skills' }] : []),
            ...(isAdmin ? [{ screen: 'accounts', icon: Users, label: 'Partners' }] : []),
            ...((isAdmin || user?.account_role === 'account_admin') ? [{ screen: 'team', icon: Mail, label: 'Team' }] : []),
          ].map(item => <SidebarItem key={item.screen} {...item} />)}

          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.1)', margin: sidebarExpanded ? '0.5rem 0.875rem' : '0.5rem 0.5rem' }} />
          {!['contributor', 'client_contact'].includes(user?.account_role) && (
            <SidebarItem screen="configuration" icon={Settings} label="Configuration" />
          )}
          {/* PR 4: SF conflicts page — visible to admins; badge if unresolved > 0 */}
          {(isAdmin || ['account_admin'].includes(user?.account_role)) && salesforceUnresolvedConflicts > 0 && (
            <SidebarItem
              screen="sf-conflicts"
              icon={AlertTriangle}
              label={`SF Conflicts (${salesforceUnresolvedConflicts})`}
              color="#a16207"
            />
          )}
          {currentScreen !== 'dashboard' && clientId && !['contributor', 'client_contact'].includes(user?.account_role) && (
            <SidebarItem screen="branding" icon={Image} label="Branding" />
          )}
        </nav>

        {/* Bottom section: theme + logout */}
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', padding: '0.5rem 0' }}>
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            title={!sidebarExpanded ? (theme === 'dark' ? 'Dark Mode' : 'Light Mode') : undefined}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderLeft: '3px solid transparent',
              color: 'rgba(255, 255, 255, 0.7)',
              padding: sidebarExpanded ? '0.6rem 0.875rem' : '0.6rem 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarExpanded ? 'flex-start' : 'center',
              gap: '0.6rem',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500,
              transition: 'all 0.2s'
            }}
          >
            {theme === 'dark' ? <Moon size={17} style={{ flexShrink: 0 }} /> : <Sun size={17} style={{ flexShrink: 0 }} />}
            {sidebarExpanded && (theme === 'dark' ? 'Dark Mode' : 'Light Mode')}
          </button>

          {/* Sign Out */}
          <SidebarItem
            icon={LogOut}
            label="Sign Out"
            onClick={handleLogout}
            active={false}
            color="#ef4444"
          />
        </div>
      </aside>

      {/* Header — fixed position, spans from sidebar edge to right edge */}
      <header className="header" style={{ position: 'fixed', top: 0, left: `${contentOffset}px`, right: 0, zIndex: 130, transition: 'left 0.2s ease' }}>
        <div className="header-inner">
          <div className="header-left">
            <div className="header-title">
              <h1>
                <span className="header-title-desktop">XO Capture</span>
                <span className="header-title-mobile">XO Capture</span>
                <span className="version-badge">Rapid Prototype</span>
              </h1>
              {currentScreen === 'dashboard' && (
                <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {isAccount && !isAdmin ? 'Partner Dashboard' : 'Client Dashboard'}
                </p>
              )}
            </div>
          </div>
          <div className="header-right" style={{display: 'flex', alignItems: 'center'}}>
            <div style={{cursor:"pointer"}} onClick={()=>{window.open("https://www.intellagentic.io","_blank")}}>
            <IntellagenticLogo height={32} />
            </div>
          </div>
        </div>
      </header>

      {/* Right side: content area */}
      <div style={{ flex: 1, marginLeft: `${contentOffset}px`, transition: 'margin-left 0.2s ease', overflowX: 'hidden', minWidth: 0, paddingTop: '52px' }}>

      {/* Main Content */}
      <main className="main">
        {/* Client Identity Banner — shown when inside a workspace */}
        {currentScreen !== 'dashboard' && currentScreen !== 'accounts' && currentScreen !== 'team' && inWorkspace && clientId && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '1.25rem 0 0.75rem 0'
          }}>
            {companyData.logoUrl ? (
              <div>
                <img src={companyData.logoUrl} alt={companyData.name} style={{ height: '56px', maxWidth: '240px', objectFit: 'contain' }} />
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {(isAdmin || isAccount) ? 'Partner Workspace' : (companyData.name || 'My Workspace')}
                </div>
              </div>
            ) : (
              <>
                {companyData.iconUrl ? (
                  <img src={companyData.iconUrl} alt="" style={{ width: '56px', height: '56px', objectFit: 'contain', borderRadius: '10px', flexShrink: 0 }} />
                ) : (
                  <div style={{
                    width: '56px', height: '56px', borderRadius: '10px', flexShrink: 0,
                    background: '#1a1a2e',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.25rem', fontWeight: 700, color: '#dc2626'
                  }}>
                    {(companyData.name || '?')[0].toUpperCase()}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                    {companyData.name || 'New Client'}
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {(isAdmin || isAccount) ? 'Partner Workspace' : (companyData.name || 'My Workspace')}
                  </div>
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    {companyData.updated_at?<span style={{ fontSize: '0.6875rem', color: 'var(--text-muted, #9ca3af)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {companyData.updated_at?"Last Updated: "+formatDateTime(companyData.updated_at)+(companyData.updated_by?" by "+companyData.updated_by:" ") :""}
        </span>:""}
                  </div>
                </div>
              </>
            )}
            {(isAdmin || isAccount) && clientId && (
              <button
                onClick={() => setShowShareModal(true)}
                style={{
                  background: 'none', border: '1px solid var(--border-color, #d1d5db)',
                  borderRadius: '8px', padding: '0.4rem 0.75rem', cursor: 'pointer',
                  color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                  transition: 'all 0.2s', marginLeft: 'auto'
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#dc2626'; e.currentTarget.style.color = '#dc2626' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color, #d1d5db)'; e.currentTarget.style.color = 'var(--text-secondary)' }}
              >
                <Share2 size={14} /> Share
              </button>
            )}
          </div>
        )}

        {/* Page Action Buttons (filtered by showOn for current screen) */}
        <PageActionButtons
          page={currentScreen === 'upload' ? 'welcome' : currentScreen}
          systemButtons={systemButtons}
          configButtons={configButtons}
          onNavigate={navigateTo}
        />

        {/* Screen Content */}
        {currentScreen === 'dashboard' && (
          <DashboardScreen
            onSelectClient={handleSelectClient}
            onCreateClient={handleCreateNewClient}
            isAdmin={isAdmin}
            isAccount={isAccount}
            accounts={accounts}
            teamUsers={teamUsers}
            user={user}
          />
        )}
        {currentScreen === 'upload' && (
          <UploadScreen
            setClientId={setClientId}
            clientId={clientId}
            companyData={companyData}
            setCompanyData={setCompanyData}
            onClientCreate={handleClientCreate}
            onSelectClient={handleSelectClient}
            onComplete={() => setCurrentScreen('enrich')}
            onOpenCompanyModal={() => setShowCompanyModal(true)}
            configButtons={configButtons}
            systemButtons={systemButtons}
            onNavigate={navigateTo}
            isAdmin={isAdmin}
            isAccount={isAccount}
            accounts={accounts}
            engagements={engagements}
            setEngagements={setEngagements}
            activeEngagement={activeEngagement}
            setActiveEngagement={setActiveEngagement}
            teamUsers={teamUsers}
          />
        )}
        {currentScreen === 'sources' && (
          <SourcesScreen
            clientId={clientId}
            companyData={companyData}
            onNavigate={navigateTo}
            preferredModel={preferredModel}
            isAdmin={isAdmin}
          />
        )}
        {currentScreen === 'enrich' && (
          <div data-dxo="enrichment-results" style={{ display: 'contents' }}>
          <EnrichScreen
            clientId={clientId}
            onComplete={() => setCurrentScreen('results')}
            preferredModel={preferredModel}
            activeEngagement={activeEngagement}
            onNavigate={navigateTo}
          />
          </div>
        )}
        {currentScreen === 'results' && (
          <div data-dxo="results-page" style={{ display: 'contents' }}>
            <ResultsScreen setShowModal={setShowModal} clientId={clientId} isAdmin={isAdmin} systemButtons={systemButtons} theme={theme} preferredModel={preferredModel} activeEngagement={activeEngagement} setActiveEngagement={setActiveEngagement} onNavigate={navigateTo} />
          </div>
        )}
        {currentScreen === 'skills' && <SkillsScreen clientId={clientId} isAdmin={isAdmin} preferredModel={preferredModel} activeEngagement={activeEngagement} onNavigate={navigateTo} />}
        {currentScreen === 'configuration' && <ConfigurationScreen theme={theme} toggleTheme={toggleTheme} buttons={configButtons} setButtons={saveButtons} systemButtons={systemButtons} setSystemButtons={saveSystemButtons} preferredModel={preferredModel} setPreferredModel={saveModelPreference} clientId={clientId} inWorkspace={inWorkspace} isAdmin={isAdmin} companyName={companyData.name} salesforceConnected={salesforceConnected} setSalesforceConnected={setSalesforceConnected} salesforceInstanceUrl={salesforceInstanceUrl} setSalesforceInstanceUrl={setSalesforceInstanceUrl} salesforceError={salesforceError} setSalesforceError={setSalesforceError} salesforceLastPullAt={salesforceLastPullAt} setSalesforceLastPullAt={setSalesforceLastPullAt} salesforceUnresolvedConflicts={salesforceUnresolvedConflicts} setSalesforceUnresolvedConflicts={setSalesforceUnresolvedConflicts} salesforceStatusLoaded={salesforceStatusLoaded} onNavigate={navigateTo} />}
        {currentScreen === 'branding' && <BrandingScreen clientId={clientId} companyData={companyData} setCompanyData={setCompanyData} />}
        {currentScreen === 'accounts' && isAdmin && <AccountsScreen accounts={accounts} setAccounts={setAccounts} teamUsers={teamUsers} />}
        {currentScreen === 'team' && (isAdmin || user?.account_role === 'account_admin') && <TeamScreen isAdmin={isAdmin} user={user} accounts={accounts} teamUsers={teamUsers} setTeamUsers={setTeamUsers} />}
        {currentScreen === 'sf-conflicts' && (isAdmin || user?.account_role === 'account_admin') && (
          <SalesforceConflictsScreen
            apiBase={API_BASE}
            getAuthHeaders={getAuthHeaders}
            onResolved={() => {
              // Refresh status after a resolve so the sidebar count + header reflect reality.
              fetch(`${API_BASE}/salesforce/status`, { headers: getAuthHeaders() })
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                  if (d) setSalesforceUnresolvedConflicts(d.unresolved_conflicts || 0)
                })
                .catch(() => {})
            }}
          />
        )}

      </main>

      </div>{/* end right-side wrapper */}

      {/* Footer -- outside content wrapper so overflowX:hidden doesn't affect it.
          Position is fixed (sidebar-offset is dynamic), but typography / border /
          background come from the .app-footer class so the post-login footer
          looks identical to the sign-in screen footer. */}
      <footer
        className="app-footer"
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200 }}
      >
        <span className="app-footer-left">
          <IntellagenticLogo height={20} />
          <span className="app-footer-dash">&mdash;</span>
          <span className="app-footer-tagline">The end of guesswork.</span>
        </span>
        <span className="app-footer-right">
          <a href="/terms">Terms</a>
          <span className="app-footer-sep" aria-hidden="true">&middot;</span>
          <a href="/privacy">Privacy</a>
          <span className="app-footer-sep" aria-hidden="true">&middot;</span>
          <a href="/security">Security</a>
          <span className="app-footer-rule" aria-hidden="true" />
          <span className="app-footer-meta">&copy; 2026 INTELLAGENTIC LIMITED.</span>
        </span>
      </footer>

      {/* Company Information Modal */}
      {showCompanyModal && (
        <CompanyInfoModal
          companyData={companyData}
          setCompanyData={setCompanyData}
          onClose={() => setShowCompanyModal(false)}
          onClientCreate={handleClientCreateFromDashboard}
          clientId={clientId}
          accounts={accounts}
          isAdmin={isAdmin}
        />
      )}

      {showShareModal && clientId && (
        <ShareLinkModal
          clientId={clientId}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  )
}

// ============================================================
// PARTNERS SCREEN — CRUD management for channel partners (admin only)
// ============================================================
function AccountsScreen({ accounts, setAccounts, teamUsers }) {
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editPartner, setEditPartner] = useState(null)
  const [form, setForm] = useState({ name: '', website: '', industry: '', notes: '', description: '', futurePlans: '' })
  const [formPainPoints, setFormPainPoints] = useState([''])
  const [formContacts, setFormContacts] = useState([])
  const [formAddresses, setFormAddresses] = useState([])
  const [contactsExpanded, setContactsExpanded] = useState(false)
  const [addressesExpanded, setAddressesExpanded] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [partnerSearch, setPartnerSearch] = useState('')
  const [partnerIndustryFilter, setPartnerIndustryFilter] = useState('')

  const partnerIndustries = useMemo(() => [...new Set(accounts.map(a => a.industry).filter(Boolean))].sort(), [accounts])
  const filteredAccounts = useMemo(() => {
    let result = accounts
    if (partnerSearch.trim()) {
      const q = partnerSearch.toLowerCase()
      result = result.filter(a => (a.name || '').toLowerCase().includes(q) || (a.company || '').toLowerCase().includes(q) || (a.contacts || []).some(c => ((c.firstName || '') + ' ' + (c.lastName || '')).toLowerCase().includes(q)))
    }
    if (partnerIndustryFilter) result = result.filter(a => a.industry === partnerIndustryFilter)
    return result
  }, [accounts, partnerSearch, partnerIndustryFilter])

  const fetchPartners = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/accounts`, { headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        setAccounts(data.accounts || [])
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err)
    }
    setLoading(false)
  }

  useEffect(() => { fetchPartners() }, [])

  const openAdd = () => {
    setEditPartner(null)
    setForm({ name: '', website: '', industry: '', notes: '', description: '', futurePlans: '' })
    setFormPainPoints([''])
    setFormContacts([{ firstName: '', lastName: '', title: '', email: '', phone: '', linkedin: '', photo_url: '' }])
    setFormAddresses([])
    setContactsExpanded(false)
    setAddressesExpanded(false)
    setShowForm(true)
  }

  const openEdit = (p) => {
    setEditPartner(p)
    setForm({ name: p.name || '', website: p.website || '', industry: p.industry || '', notes: p.notes || '', description: p.description || '', futurePlans: p.futurePlans || '' })
    const pts = p.painPoints || []
    setFormPainPoints(pts.length > 0 ? [...pts] : [''])
    setFormContacts((p.contacts && p.contacts.length > 0) ? p.contacts.map(c => ({ ...c })) : [{ firstName: '', lastName: '', title: '', email: p.email || '', phone: p.phone || '', linkedin: '' }])
    setFormAddresses((p.addresses && p.addresses.length > 0) ? p.addresses.map(a => ({ ...a })) : [])
    setContactsExpanded(false)
    setAddressesExpanded(false)
    setShowForm(true)
  }

  const addFormContact = () => setFormContacts(prev => [...prev, { firstName: '', lastName: '', title: '', email: '', phone: '', linkedin: '', photo_url: '' }])
  const updateFormContact = (index, field, value) => setFormContacts(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c))
  const removeFormContact = (index) => setFormContacts(prev => prev.filter((_, i) => i !== index))
  const addFormAddress = () => setFormAddresses(prev => [...prev, { label: '', address1: '', address2: '', city: '', state: '', postalCode: '', country: '' }])
  const updateFormAddress = (index, field, value) => setFormAddresses(prev => prev.map((a, i) => i === index ? { ...a, [field]: value } : a))
  const removeFormAddress = (index) => setFormAddresses(prev => prev.filter((_, i) => i !== index))

  const handleSave = async () => {
    if (!form.name.trim()) { alert('Organization name is required'); return }
    const primaryContact = formContacts[0] || {}
    const filteredPainPoints = formPainPoints.filter(p => p.trim())
    const payload = {
      ...form,
      company: form.name,
      email: primaryContact.email || '',
      phone: primaryContact.phone || '',
      contacts: formContacts,
      addresses: formAddresses,
      painPoints: filteredPainPoints
    }
    try {
      const res = editPartner
        ? await fetch(`${API_BASE}/accounts`, {
            method: 'PUT', headers: getAuthHeaders(),
            body: JSON.stringify({ id: editPartner.id, ...payload })
          })
        : await fetch(`${API_BASE}/accounts`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify(payload)
          })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        alert(errData.error || 'Failed to save partner')
        return
      }
      setShowForm(false)
      await fetchPartners()
    } catch (err) {
      alert('Failed to save partner')
    }
  }

  const handleDelete = async (id) => {
    try {
      await fetch(`${API_BASE}/accounts?id=${id}`, { method: 'DELETE', headers: getAuthHeaders() })
      setDeleteConfirm(null)
      fetchPartners()
    } catch (err) {
      alert('Failed to delete partner')
    }
  }

  const fieldStyle = {
    width: '100%', padding: '0.625rem',
    border: '1px solid var(--border-color)', borderRadius: '8px',
    fontSize: '0.875rem', fontFamily: 'inherit',
    background: 'var(--bg-input, #ffffff)', color: 'var(--text-primary)'
  }
  const contactFieldStyle = {
    width: '100%', padding: '0.5rem',
    border: '1px solid var(--border-color)', borderRadius: '6px',
    fontSize: '0.8rem', fontFamily: 'inherit',
    background: 'var(--bg-input, #ffffff)', color: 'var(--text-primary)'
  }
  const sectionLabelStyle = { fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }
  const fieldLabelStyle = { display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Partners <span style={{ fontWeight: 400, color: 'var(--text-muted, #6b7280)', fontSize: '0.8125rem' }}>({filteredAccounts.length})</span>
        </h2>
        <button onClick={openAdd} className="action-btn red"><Plus size={14} /> Add Partner</button>
      </div>
      {accounts.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: '0.875rem', alignItems: 'center' }}>
          <input value={partnerSearch} onChange={e => setPartnerSearch(e.target.value)} placeholder="Search partners..."
            style={{ width: 300, padding: '0.45rem 0.625rem', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 6, background: 'var(--bg-input, #fff)', color: 'var(--text-primary)', outline: 'none', height: 36 }} />
          {partnerIndustries.length > 0 && (
            <select value={partnerIndustryFilter} aria-label="Filter by industry" onChange={e => setPartnerIndustryFilter(e.target.value)}
              style={{ width: 150, padding: '0.45rem 0.5rem', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 6, background: 'var(--bg-input, #fff)', color: 'var(--text-primary)', outline: 'none', height: 36 }}>
              <option value="">All Industries</option>
              {partnerIndustries.map(ind => <option key={ind} value={ind}>{ind}</option>)}
            </select>
          )}
          {(partnerSearch || partnerIndustryFilter) && (
            <button onClick={() => { setPartnerSearch(''); setPartnerIndustryFilter('') }}
              style={{ fontSize: '0.7rem', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#dc2626' }} />
        </div>
      ) : accounts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <Users size={40} style={{ margin: '0 auto 0.75rem', color: 'var(--text-muted, #9ca3af)' }} />
          <p>No partners yet. Add your first channel partner.</p>
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#9ca3af', fontSize: '0.8rem' }}>
          No partners match your filters.
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card, #ffffff)', border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
          {filteredAccounts.map((p) => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 0.875rem',
              borderBottom: '1px solid var(--border-color, #e5e7eb)',
              transition: 'background 0.15s'
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-alt, #fafafa)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{
                width: '28px', height: '28px', borderRadius: '6px', flexShrink: 0,
                background: 'var(--bg-secondary, #f3f4f6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.7rem', fontWeight: 700, color: '#dc2626'
              }}>
                {(p.name || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>{p.name}</div>
                {(p.contacts && p.contacts.length > 0 && (p.contacts[0].firstName || p.contacts[0].lastName)) ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    {(p.contacts[0].photo_url || (p.contacts[0].email && teamUsers.find(t => t.email === p.contacts[0].email)?.photo_url)) ? (
                      <img src={p.contacts[0].photo_url || teamUsers.find(t => t.email === p.contacts[0].email)?.photo_url} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : null}
                    {[p.contacts[0].firstName, p.contacts[0].lastName].filter(Boolean).join(' ')}{p.contacts[0].title ? ` — ${p.contacts[0].title}` : ''}
                  </div>
                ) : p.email ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)' }}>{p.email}</div>
                ) : null}
              </div>
              {p.industry && <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.industry}</span>}
              <button onClick={() => openEdit(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }} title="Edit">
                <Edit2 size={14} />
              </button>
              <button onClick={() => setDeleteConfirm(p)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }} title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Partner Modal — matches Organization Profile layout */}
      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Building2 size={20} className="icon-red" />
                <h2>{editPartner ? 'Edit Partner' : 'Add Partner'}</h2>
              </div>
              <button className="modal-close" onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gap: '1rem' }}>
                {/* Organization Name */}
                <div>
                  <label style={fieldLabelStyle}>Company/Organization Name *</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="Enter organization name" style={fieldStyle} />
                </div>

                {/* Website */}
                <div>
                  <label style={fieldLabelStyle}>Website URL</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input type="url" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })}
                      placeholder="https://example.com" style={{ ...fieldStyle, flex: 1 }} />
                    {form.website && (
                      <a href={form.website.startsWith('http') ? form.website : `https://${form.website}`} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--accent-color, #3b82f6)', padding: '0.375rem', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Open website">
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </div>
                </div>

                {/* Industry */}
                <div>
                  <label style={fieldLabelStyle}>Industry/Vertical</label>
                  <input value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })}
                    placeholder="e.g., Waste Management, Healthcare, Hospitality" style={fieldStyle} />
                </div>

                {/* Current Business Description */}
                <div>
                  <label style={fieldLabelStyle}>Current Business Description</label>
                  <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                    placeholder="Brief description of the business" rows={4} style={{ ...fieldStyle, resize: 'vertical', minHeight: '100px' }} />
                </div>

                {/* Future Plans */}
                <div>
                  <label style={fieldLabelStyle}>Future Plans</label>
                  <textarea value={form.futurePlans} onChange={e => setForm({ ...form, futurePlans: e.target.value })}
                    placeholder="Where is the business heading? Growth plans, strategic goals..." rows={4} style={{ ...fieldStyle, resize: 'vertical', minHeight: '100px' }} />
                </div>

                {/* Pain Points */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <label style={sectionLabelStyle}>Pain Points</label>
                    <button type="button" onClick={() => setFormPainPoints(prev => [...prev, ''])}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 500, background: 'var(--accent-color, #3b82f6)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                      <Plus size={14} /> Add
                    </button>
                  </div>
                  {formPainPoints.map((point, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <textarea value={point} onChange={e => setFormPainPoints(prev => prev.map((p, i) => i === idx ? e.target.value : p))}
                        placeholder={`Pain point ${idx + 1}...`} rows={4} style={{ ...fieldStyle, flex: 1, resize: 'vertical', minHeight: '100px' }} />
                      {formPainPoints.length > 1 && (
                        <button type="button" onClick={() => setFormPainPoints(prev => prev.filter((_, i) => i !== idx))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.5rem' }} title="Remove">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Contacts Section */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <label style={sectionLabelStyle}>Contacts</label>
                    <button type="button" onClick={addFormContact}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 500, background: 'var(--accent-color, #3b82f6)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                      <Plus size={14} /> Add Contact
                    </button>
                  </div>
                  {formContacts.length === 0 && (
                    <div style={{ border: '2px dashed var(--border-color)', borderRadius: '8px', padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      <User size={24} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                      <div style={{ fontSize: '0.85rem' }}>No contacts added yet</div>
                      <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Click "Add Contact" to add a primary contact</div>
                    </div>
                  )}
                  {formContacts.map((contact, idx) => (idx > 0 && !contactsExpanded) ? null : (
                    <div key={idx} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: idx === 0 ? 'var(--accent-color, #3b82f6)' : 'var(--text-secondary)' }}>
                          {idx === 0 ? 'Primary Contact' : `Contact ${idx + 1}`}
                        </span>
                        <button type="button" onClick={() => removeFormContact(idx)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px' }} title="Remove contact">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          <input type="text" value={contact.firstName || ''} onChange={e => updateFormContact(idx, 'firstName', e.target.value)}
                            placeholder="First Name" style={contactFieldStyle} />
                          <input type="text" value={contact.lastName || ''} onChange={e => updateFormContact(idx, 'lastName', e.target.value)}
                            placeholder="Last Name" style={contactFieldStyle} />
                        </div>
                        <input type="text" value={contact.title || ''} onChange={e => updateFormContact(idx, 'title', e.target.value)}
                          placeholder="Title / Role" style={contactFieldStyle} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          <input type="email" value={contact.email || ''} onChange={e => updateFormContact(idx, 'email', e.target.value)}
                            placeholder="Email" style={contactFieldStyle} />
                          <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <select value={splitPhone(contact.phone).countryCode} aria-label="Country code" onChange={e => updateFormContact(idx, 'phone', joinPhone(e.target.value, splitPhone(contact.phone).number))}
                              style={{ ...contactFieldStyle, width: '80px', flexShrink: 0, padding: '0.35rem 0.2rem' }}>
                              {COUNTRY_CODES.map(cc => <option key={cc.code} value={cc.code}>{cc.code}</option>)}
                            </select>
                            <input type="tel" value={splitPhone(contact.phone).number} onChange={e => updateFormContact(idx, 'phone', joinPhone(splitPhone(contact.phone).countryCode, e.target.value))}
                              placeholder="Phone" style={{ ...contactFieldStyle, flex: 1 }} />
                          </div>
                        </div>
                        <input type="url" value={contact.linkedin || ''} onChange={e => updateFormContact(idx, 'linkedin', e.target.value)}
                          placeholder="LinkedIn URL" style={contactFieldStyle} />
                      </div>
                    </div>
                  ))}
                  {formContacts.length > 1 && (
                    <button type="button" onClick={() => setContactsExpanded(prev => !prev)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0', fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-color, #3b82f6)' }}>
                      {contactsExpanded ? <><ChevronUp size={14} /> Hide {formContacts.length - 1} more contact{formContacts.length - 1 > 1 ? 's' : ''}</> : <><ChevronDown size={14} /> View {formContacts.length - 1} more contact{formContacts.length - 1 > 1 ? 's' : ''}</>}
                    </button>
                  )}
                </div>

                {/* Addresses Section */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <label style={sectionLabelStyle}>Addresses</label>
                    <button type="button" onClick={addFormAddress}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 500, background: 'var(--accent-color, #3b82f6)', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
                      <Plus size={14} /> Add Address
                    </button>
                  </div>
                  {formAddresses.length === 0 && (
                    <div style={{ border: '2px dashed var(--border-color)', borderRadius: '8px', padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      <MapPin size={24} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                      <div style={{ fontSize: '0.85rem' }}>No addresses added yet</div>
                      <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Click "Add Address" to add a location</div>
                    </div>
                  )}
                  {formAddresses.map((addr, idx) => (idx > 0 && !addressesExpanded) ? null : (
                    <div key={idx} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: idx === 0 ? 'var(--accent-color, #3b82f6)' : 'var(--text-secondary)' }}>
                          {idx === 0 ? 'Primary Address' : `Address ${idx + 1}`}
                        </span>
                        <button type="button" onClick={() => removeFormAddress(idx)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px' }} title="Remove address">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <input type="text" value={addr.label || ''} onChange={e => updateFormAddress(idx, 'label', e.target.value)}
                          placeholder="Label (e.g., Headquarters, Warehouse)" style={contactFieldStyle} />
                        <input type="text" value={addr.address1 || ''} onChange={e => updateFormAddress(idx, 'address1', e.target.value)}
                          placeholder="Address Line 1" style={contactFieldStyle} />
                        <input type="text" value={addr.address2 || ''} onChange={e => updateFormAddress(idx, 'address2', e.target.value)}
                          placeholder="Address Line 2" style={contactFieldStyle} />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          <input type="text" value={addr.city || ''} onChange={e => updateFormAddress(idx, 'city', e.target.value)}
                            placeholder="City" style={contactFieldStyle} />
                          <input type="text" value={addr.state || ''} onChange={e => updateFormAddress(idx, 'state', e.target.value)}
                            placeholder="State / Province" style={contactFieldStyle} />
                          <input type="text" value={addr.postalCode || ''} onChange={e => updateFormAddress(idx, 'postalCode', e.target.value)}
                            placeholder="Postal Code" style={contactFieldStyle} />
                          <input type="text" value={addr.country || ''} onChange={e => updateFormAddress(idx, 'country', e.target.value)}
                            placeholder="Country" style={contactFieldStyle} />
                        </div>
                      </div>
                    </div>
                  ))}
                  {formAddresses.length > 1 && (
                    <button type="button" onClick={() => setAddressesExpanded(prev => !prev)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.25rem 0', fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-color, #3b82f6)' }}>
                      {addressesExpanded ? <><ChevronUp size={14} /> Hide {formAddresses.length - 1} more address{formAddresses.length - 1 > 1 ? 'es' : ''}</> : <><ChevronDown size={14} /> View {formAddresses.length - 1} more address{formAddresses.length - 1 > 1 ? 'es' : ''}</>}
                    </button>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label style={fieldLabelStyle}>Notes</label>
                  <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    placeholder="Additional notes..." rows={3} style={{ ...fieldStyle, resize: 'vertical' }} />
                </div>
              </div>
            </div>
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={() => setShowForm(false)} className="action-btn" style={{ background: 'var(--bg-secondary)' }}>Cancel</button>
              <button onClick={handleSave} className="action-btn red"><Save size={14} /> {editPartner ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h2>Delete Partner</h2>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to delete <strong>{deleteConfirm.name}</strong>? Clients linked to this partner will be unlinked.</p>
            </div>
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={() => setDeleteConfirm(null)} className="action-btn">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm.id)} className="action-btn" style={{ background: '#dc2626', color: '#fff' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// TEAM SCREEN — User management and invitations
// ============================================================
function TeamScreen({ isAdmin, user, accounts, teamUsers, setTeamUsers }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [photoPopover, setPhotoPopover] = useState(null)
  const [photoUrlInput, setPhotoUrlInput] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [inviteRole, setInviteRole] = useState('account_user')
  const [inviteAccountId, setInviteAccountId] = useState(user?.account_id || '')
  const [inviteSending, setInviteSending] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState(null)
  const [inviteClients, setInviteClients] = useState([])
  const [inviteSelectedClients, setInviteSelectedClients] = useState(new Set())
  const [inviteClientSearch, setInviteClientSearch] = useState('')
  const [inviteClientsLoaded, setInviteClientsLoaded] = useState(false)

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/invite`, { headers: getAuthHeaders() })
      if (res.ok) { const data = await res.json(); const u = data.users || []; setUsers(u); if (setTeamUsers) setTeamUsers(u) }
    } catch (err) { console.error('Failed to fetch users:', err) }
    setLoading(false)
  }

  const [assignUser, setAssignUser] = useState(null) // user object being assigned
  const [assignClients, setAssignClients] = useState([]) // all available clients
  const [assignSelected, setAssignSelected] = useState(new Set()) // selected client DB ids
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignSaving, setAssignSaving] = useState(false)
  const [assignClientSearch, setAssignClientSearch] = useState('')

  useEffect(() => { fetchUsers() }, [])

  const openAssignModal = async (u) => {
    setAssignUser(u)
    setAssignClientSearch('')
    setAssignLoading(true)
    try {
      // Fetch all clients
      const cRes = await fetch(`${API_BASE}/clients/list`, { headers: getAuthHeaders() })
      const cData = cRes.ok ? await cRes.json() : { clients: [] }
      setAssignClients(cData.clients || [])
      // Fetch current assignments
      const aRes = await fetch(`${API_BASE}/auth/users/${u.id}/clients`, { headers: getAuthHeaders() })
      const aData = aRes.ok ? await aRes.json() : { assignments: [] }
      setAssignSelected(new Set((aData.assignments || []).map(a => a.client_id)))
    } catch (err) { console.error('Failed to load assignments:', err) }
    setAssignLoading(false)
  }

  const saveAssignments = async () => {
    if (!assignUser) return
    setAssignSaving(true)
    try {
      const res = await fetch(`${API_BASE}/auth/users/${assignUser.id}/clients`, {
        method: 'POST', headers: getAuthHeaders(),
        body: JSON.stringify({ client_ids: Array.from(assignSelected) })
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      setAssignUser(null)
    } catch (err) { alert(err.message) }
    setAssignSaving(false)
  }

  const inviteNeedsClients = ['account_user', 'client_contact', 'contributor'].includes(inviteRole)

  const fetchInviteClients = async () => {
    if (inviteClientsLoaded) return
    try {
      const res = await fetch(`${API_BASE}/clients/list`, { headers: getAuthHeaders() })
      if (res.ok) { const d = await res.json(); setInviteClients(d.clients || []) }
    } catch (_) {}
    setInviteClientsLoaded(true)
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return
    setInviteSending(true)
    setInviteSuccess(null)
    try {
      const res = await fetch(`${API_BASE}/auth/invite`, {
        method: 'POST', headers: getAuthHeaders(),
        body: JSON.stringify({ email: inviteEmail.trim(), name: inviteName.trim(), account_id: inviteAccountId || undefined, account_role: inviteRole })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send invite')

      // Assign selected clients if any
      if (inviteNeedsClients && inviteSelectedClients.size > 0 && data.user_id) {
        try {
          await fetch(`${API_BASE}/auth/users/${data.user_id}/clients`, {
            method: 'POST', headers: getAuthHeaders(),
            body: JSON.stringify({ client_ids: Array.from(inviteSelectedClients) })
          })
        } catch (_) {}
      }

      setInviteSuccess(`Invitation sent to ${inviteEmail}`)
      setInviteEmail('')
      setInviteName('')
      setInviteSelectedClients(new Set())
      setShowInviteModal(false)
      fetchUsers()
      setTimeout(() => setInviteSuccess(null), 5000)
    } catch (err) { alert(err.message) }
    setInviteSending(false)
  }

  const handleResend = async (userId) => {
    try {
      const res = await fetch(`${API_BASE}/auth/invite/resend`, {
        method: 'POST', headers: getAuthHeaders(),
        body: JSON.stringify({ user_id: userId })
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
      alert('Invitation resent')
    } catch (err) { alert(err.message) }
  }

  const [teamSearch, setTeamSearch] = useState('')
  const [teamRoleFilter, setTeamRoleFilter] = useState('')
  const [teamStatusFilter, setTeamStatusFilter] = useState('')

  const roleLabels = { super_admin: 'Super Admin', account_admin: 'Account Admin', account_user: 'Account User', contributor: 'Contributor', client_contact: 'Client Contact' }
  const roleHierarchy = ['super_admin', 'account_admin', 'account_user', 'contributor', 'client_contact']
  const statusColors = { active: { bg: '#dcfce7', color: '#16a34a' }, invited: { bg: '#dbeafe', color: '#2563eb' }, deactivated: { bg: '#fee2e2', color: '#dc2626' } }

  const filteredUsers = useMemo(() => {
    let result = users
    if (teamSearch.trim()) {
      const q = teamSearch.toLowerCase()
      result = result.filter(u => (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
    }
    if (teamRoleFilter) result = result.filter(u => u.account_role === teamRoleFilter)
    if (teamStatusFilter) result = result.filter(u => u.status === teamStatusFilter)
    return result
  }, [users, teamSearch, teamRoleFilter, teamStatusFilter])

  const filterCtrlStyle = { padding: '0.45rem 0.5rem', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 6, background: 'var(--bg-input, #fff)', color: 'var(--text-primary)', outline: 'none', height: 36 }

  return (
    <div className="panel">
      {/* Row 1: Title + action button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color, #e5e7eb)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Mail size={20} className="icon-red" />
          <h2 style={{ margin: 0 }}>Team</h2>
          <span className="badge-count blue">{filteredUsers.length}</span>
        </div>
        <button onClick={() => setShowInviteModal(true)} className="action-btn red" style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}>
          <Plus size={14} /> Invite User
        </button>
      </div>
      <div style={{ padding: '1.25rem' }}>
        {inviteSuccess && <div style={{ padding: '0.5rem 0.75rem', background: '#dcfce7', borderRadius: 6, fontSize: '0.8rem', color: '#16a34a', marginBottom: '0.75rem' }}>{inviteSuccess}</div>}

        {/* Row 2: Filters */}
        {users.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginBottom: '0.75rem', alignItems: 'center' }}>
            <input
              value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
              placeholder="Search name or email..."
              style={{ ...filterCtrlStyle, width: 300 }}
            />
            <select value={teamRoleFilter} aria-label="Filter by role" onChange={e => setTeamRoleFilter(e.target.value)} style={{ ...filterCtrlStyle, width: 150 }}>
              <option value="">All Roles</option>
              {roleHierarchy.map(r => <option key={r} value={r}>{roleLabels[r]}</option>)}
            </select>
            <select value={teamStatusFilter} aria-label="Filter by status" onChange={e => setTeamStatusFilter(e.target.value)} style={{ ...filterCtrlStyle, width: 150 }}>
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="deactivated">Deactivated</option>
            </select>
            {(teamSearch || teamRoleFilter || teamStatusFilter) && (
              <button onClick={() => { setTeamSearch(''); setTeamRoleFilter(''); setTeamStatusFilter('') }}
                style={{ fontSize: '0.7rem', color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Clear</button>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#dc2626' }} /></div>
        ) : users.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
            <p>No team members yet. Invite your first user.</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: '#9ca3af', fontSize: '0.8rem' }}>
            No users match your filters.
          </div>
        ) : (() => {
          // Group by account, sort within groups: active > invited > deactivated, then alphabetical
          const statusOrder = { active: 0, invited: 1, deactivated: 2 }
          const sorted = [...filteredUsers].sort((a, b) => {
            const sa = statusOrder[a.status] ?? 1, sb = statusOrder[b.status] ?? 1
            if (sa !== sb) return sa - sb
            return (a.name || '').localeCompare(b.name || '')
          })
          const groups = {}
          sorted.forEach(u => {
            const key = u.account_name || (u.account_id ? `Account ${u.account_id}` : '_unassigned')
            if (!groups[key]) groups[key] = []
            groups[key].push(u)
          })
          const groupKeys = Object.keys(groups).filter(k => k !== '_unassigned').sort()
          if (groups._unassigned) groupKeys.push('_unassigned')

          return (
          <div>
            {groupKeys.map(gk => (
              <div key={gk} style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)', padding: '0.35rem 0', marginBottom: '0.375rem', borderBottom: '1px solid var(--border-color, #e5e7eb)' }}>
                  {gk === '_unassigned' ? 'Unassigned' : gk}
                  <span style={{ fontWeight: 400, color: '#9ca3af', marginLeft: '0.5rem' }}>({groups[gk].length})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {groups[gk].map(u => {
              const sc = statusColors[u.status] || statusColors.active
              return (
                <div key={u.id} style={{ padding: '0.625rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: 8, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div
                      style={{ width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', overflow: 'hidden', cursor: (['super_admin', 'account_admin'].includes(user?.account_role) || u.id === user?.id) ? 'pointer' : 'default' }}
                      onClick={() => { if (['super_admin', 'account_admin'].includes(user?.account_role) || u.id === user?.id) { setPhotoPopover(photoPopover === u.id ? null : u.id); setPhotoUrlInput('') } }}
                    >
                      {u.photo_url ? (
                        <img src={u.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.style.display = 'none' }} />
                      ) : (u.name || u.email || '?').charAt(0).toUpperCase()}
                    </div>
                    {photoPopover === u.id && (
                      <>
                        <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setPhotoPopover(null)} />
                        <div style={{ position: 'absolute', top: 36, left: 0, zIndex: 50, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.375rem', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: 140, whiteSpace: 'nowrap' }}>
                          <button onClick={() => {
                            setPhotoPopover(null)
                            const input = document.createElement('input')
                            input.type = 'file'; input.accept = 'image/*'
                            input.onchange = async (ev) => {
                              const file = ev.target.files[0]; if (!file) return
                              const ext = file.name.split('.').pop().toLowerCase()
                              const ctMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
                              const ct = ctMap[ext]; if (!ct) { alert('Supported: PNG, JPG, GIF, WebP, SVG'); return }
                              if (file.size > 2 * 1024 * 1024) { alert('File must be under 2MB'); return }
                              try {
                                const res = await fetch(`${API_BASE}/upload/branding`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ client_id: '_system', file_type: 'contact_photo', contact_index: `team_${u.id}`, content_type: ct, file_extension: ext }) })
                                if (!res.ok) throw new Error('Failed to get upload URL')
                                const { upload_url, view_url } = await res.json()
                                const s3Res = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': ct }, body: file })
                                if (!s3Res.ok) throw new Error('Upload failed')
                                const photoUrl = view_url || ''
                                await fetch(`${API_BASE}/auth/preferences`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ user_id: u.id, photo_url: photoUrl }) })
                                setUsers(prev => prev.map(x => x.id === u.id ? { ...x, photo_url: photoUrl } : x))
                                if (setTeamUsers) setTeamUsers(prev => prev.map(x => x.id === u.id ? { ...x, photo_url: photoUrl } : x))
                              } catch (err) { console.error('Photo upload failed:', err); alert('Photo upload failed') }
                            }
                            input.click()
                          }} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%', padding: '0.35rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#333', borderRadius: 4 }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                            <Upload size={13} /> Upload photo
                          </button>
                          {photoUrlInput !== null && photoUrlInput !== '' ? (
                            <div style={{ display: 'flex', gap: '0.25rem', padding: '0.25rem 0.5rem' }}>
                              <input type="url" value={photoUrlInput === ' ' ? '' : photoUrlInput} onChange={e => setPhotoUrlInput(e.target.value || ' ')} autoFocus
                                placeholder="https://..." style={{ flex: 1, padding: '0.25rem 0.375rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.7rem', outline: 'none', width: 120 }} />
                              <button onClick={async () => {
                                const url = photoUrlInput.trim()
                                if (url) {
                                  await fetch(`${API_BASE}/auth/preferences`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ user_id: u.id, photo_url: url }) })
                                  setUsers(prev => prev.map(x => x.id === u.id ? { ...x, photo_url: url } : x))
                                  if (setTeamUsers) setTeamUsers(prev => prev.map(x => x.id === u.id ? { ...x, photo_url: url } : x))
                                }
                                setPhotoPopover(null)
                              }} style={{ padding: '0.25rem 0.5rem', background: '#0F969C', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer', fontWeight: 600 }}>Save</button>
                            </div>
                          ) : (
                            <button onClick={() => setPhotoUrlInput(' ')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%', padding: '0.35rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#333', borderRadius: 4 }}
                              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                              <Link size={13} /> Paste URL
                            </button>
                          )}
                          {u.photo_url && (
                            <button onClick={async () => {
                              await fetch(`${API_BASE}/auth/preferences`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ user_id: u.id, photo_url: '' }) })
                              setUsers(prev => prev.map(x => x.id === u.id ? { ...x, photo_url: '' } : x))
                              if (setTeamUsers) setTeamUsers(prev => prev.map(x => x.id === u.id ? { ...x, photo_url: '' } : x))
                              setPhotoPopover(null)
                            }} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%', padding: '0.35rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#dc2626', borderRadius: 4 }}
                              onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                              <Trash2 size={13} /> Remove photo
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{u.name}</div>
                    <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{u.email}</div>
                  </div>
                  <span style={{ fontSize: '0.6rem', fontWeight: 600, padding: '0.1rem 0.35rem', borderRadius: 4, background: sc.bg, color: sc.color }}>{(u.status || 'active').toUpperCase()}</span>
                  {(u.id === user?.id || u.status === 'deactivated' || !['super_admin', 'account_admin'].includes(user?.account_role)) ? (
                    <span style={{ fontSize: '0.6rem', color: '#6b7280' }}>{roleLabels[u.account_role] || u.account_role || ''}</span>
                  ) : (
                    <select aria-label="User role"
                      value={u.account_role || ''}
                      onChange={async (e) => {
                        const newRole = e.target.value
                        if (!window.confirm(`Change ${u.name}'s role to ${newRole}?`)) { e.target.value = u.account_role; return }
                        try {
                          const res = await fetch(`${API_BASE}/auth/invite/role`, {
                            method: 'PATCH', headers: getAuthHeaders(),
                            body: JSON.stringify({ user_id: u.id, account_role: newRole })
                          })
                          if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
                          setUsers(prev => prev.map(x => x.id === u.id ? { ...x, account_role: newRole } : x))
                        } catch (err) { alert(err.message) }
                      }}
                      style={{ fontSize: '0.6rem', color: '#6b7280', background: 'var(--bg-card, #fff)', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: 4, padding: '0.1rem 0.2rem', cursor: 'pointer' }}
                    >
                      {roleHierarchy.filter((_, i) => i >= roleHierarchy.indexOf(user?.account_role)).map(r => (
                        <option key={r} value={r}>{roleLabels[r]}</option>
                      ))}
                    </select>
                  )}
                  {u.account_role && ['account_user', 'client_contact', 'contributor'].includes(u.account_role) && ['active', 'invited'].includes(u.status) && (
                    <button onClick={() => openAssignModal(u)} style={{ fontSize: '0.65rem', color: '#2563eb', background: 'none', border: '1px solid #2563eb', borderRadius: 4, cursor: 'pointer', padding: '0.1rem 0.3rem' }}>Clients</button>
                  )}
                  {u.status === 'invited' && (
                    <button onClick={() => handleResend(u.id)} style={{ fontSize: '0.65rem', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Resend</button>
                  )}
                  {u.status !== 'deactivated' && u.id !== user?.id && (
                    <button onClick={async () => {
                      if (!window.confirm(`Remove ${u.name} (${u.email})?`)) return
                      try {
                        const res = await fetch(`${API_BASE}/auth/invite?user_id=${u.id}`, { method: 'DELETE', headers: getAuthHeaders() })
                        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed') }
                        setUsers(prev => prev.filter(x => x.id !== u.id))
                      } catch (err) { alert(err.message) }
                    }} style={{ fontSize: '0.65rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              )
            })}
                </div>
              </div>
            ))}
          </div>
          )
        })()}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setShowInviteModal(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: 'var(--bg-card, #fff)', borderRadius: 16, padding: '1.5rem', width: '90%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>Invite User</h3>
              <button onClick={() => setShowInviteModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              <input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Full name" style={{ padding: '0.5rem 0.625rem', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none' }} />
              <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="Email address" type="email" style={{ padding: '0.5rem 0.625rem', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none' }} />
              <select value={inviteRole} aria-label="Role" onChange={e => { setInviteRole(e.target.value); if (['account_user', 'client_contact', 'contributor'].includes(e.target.value)) fetchInviteClients() }} style={{ padding: '0.5rem 0.625rem', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
                {isAdmin && <option value="super_admin">Super Admin</option>}
                <option value="account_admin">Account Admin</option>
                <option value="account_user">Account User</option>
                <option value="contributor">Contributor</option>
                <option value="client_contact">Client Contact</option>
              </select>
              {isAdmin && accounts && accounts.length > 0 && (
                <select value={inviteAccountId} aria-label="Account" onChange={e => setInviteAccountId(e.target.value ? parseInt(e.target.value) : '')} style={{ padding: '0.5rem 0.625rem', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
                  <option value="">No account (platform user)</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name || a.company}</option>)}
                </select>
              )}
              {inviteNeedsClients && (
                <div style={{ border: '1px solid var(--border-color, #e5e7eb)', borderRadius: 8, padding: '0.5rem 0.625rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.375rem' }}>Assign Clients</div>
                  {!inviteClientsLoaded ? (
                    <button type="button" onClick={fetchInviteClients} style={{ fontSize: '0.75rem', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>Load client list</button>
                  ) : inviteClients.length === 0 ? (
                    <div style={{ fontSize: '0.7rem', color: '#9ca3af' }}>No clients available</div>
                  ) : (
                    <>
                      <input value={inviteClientSearch} onChange={e => setInviteClientSearch(e.target.value)} placeholder="Search clients..." style={{ padding: '0.35rem 0.5rem', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: 6, fontSize: '0.75rem', fontFamily: 'inherit', outline: 'none', marginBottom: '0.35rem', width: '100%', boxSizing: 'border-box' }} />
                      <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {[...inviteClients].sort((a, b) => (a.company_name || '').localeCompare(b.company_name || '')).filter(c => !inviteClientSearch.trim() || (c.company_name || '').toLowerCase().includes(inviteClientSearch.toLowerCase())).map(c => (
                          <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={inviteSelectedClients.has(c.id)} onChange={() => setInviteSelectedClients(prev => {
                              const next = new Set(prev)
                              next.has(c.id) ? next.delete(c.id) : next.add(c.id)
                              return next
                            })} />
                            {c.company_name}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  {inviteNeedsClients && inviteSelectedClients.size === 0 && inviteClientsLoaded && inviteRole === 'client_contact' && (
                    <div style={{ fontSize: '0.65rem', color: '#f59e0b', marginTop: '0.25rem' }}>This user won't see any clients until you assign them.</div>
                  )}
                </div>
              )}
              <button onClick={handleInvite} disabled={inviteSending || !inviteEmail.trim() || !inviteName.trim()}
                style={{ padding: '0.625rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.85rem', fontWeight: 600, cursor: inviteSending ? 'wait' : 'pointer', opacity: inviteSending ? 0.7 : 1, marginTop: '0.25rem' }}>
                {inviteSending ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client Assignment Modal */}
      {assignUser && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setAssignUser(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: 'var(--bg-card, #fff)', borderRadius: 16, padding: '1.5rem', width: '90%', maxWidth: 480, maxHeight: '80vh', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>Assign Clients</h3>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: '#9ca3af' }}>{assignUser.name} ({assignUser.email})</p>
              </div>
              <button onClick={() => setAssignUser(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {assignLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#dc2626' }} /></div>
            ) : assignClients.length === 0 ? (
              <p style={{ color: '#9ca3af', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>No clients available</p>
            ) : (
              <>
                <div style={{ flex: 1, overflow: 'auto', marginBottom: '0.75rem' }}>
                  <p style={{ fontSize: '0.7rem', color: '#9ca3af', marginBottom: '0.5rem' }}>{assignSelected.size} of {assignClients.length} clients assigned</p>
                  <input
                    type="text"
                    placeholder="Search clients..."
                    value={assignClientSearch}
                    onChange={e => setAssignClientSearch(e.target.value)}
                    style={{ width: '100%', padding: '0.4rem 0.5rem', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 6, background: 'var(--bg-input, #fff)', color: 'var(--text-primary)', outline: 'none', marginBottom: '0.5rem', boxSizing: 'border-box' }}
                  />
                  {(() => {
                    const q = assignClientSearch.trim().toLowerCase()
                    const filtered = q
                      ? assignClients.filter(c =>
                          (c.company_name || c.name || '').toLowerCase().includes(q) ||
                          (c.industry || '').toLowerCase().includes(q))
                      : assignClients
                    const sorted = [...filtered].sort((a, b) =>
                      (a.company_name || a.name || '').localeCompare(
                        (b.company_name || b.name || ''), undefined, { sensitivity: 'base' }))
                    return sorted.map(c => {
                      const checked = assignSelected.has(String(c.db_id || c.id))
                      return (
                        <label key={c.db_id || c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.5rem', cursor: 'pointer', borderRadius: 6, background: checked ? 'rgba(220,38,38,0.05)' : 'transparent' }}>
                          <input type="checkbox" checked={checked} onChange={() => {
                            const id = String(c.db_id || c.id)
                            setAssignSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
                          }} style={{ accentColor: '#dc2626' }} />
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>{c.company_name || c.name || c.client_id}</span>
                          {c.account_name && <span style={{ fontSize: '0.6rem', color: '#9ca3af', marginLeft: 'auto' }}>{c.account_name}</span>}
                        </label>
                      )
                    })
                  })()}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button onClick={() => setAssignUser(null)} style={{ padding: '0.5rem 0.75rem', background: 'none', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: '0.8rem', cursor: 'pointer', color: 'var(--text-muted)' }}>Cancel</button>
                  <button onClick={saveAssignments} disabled={assignSaving}
                    style={{ padding: '0.5rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: assignSaving ? 'wait' : 'pointer', opacity: assignSaving ? 0.7 : 1 }}>
                    {assignSaving ? 'Saving...' : `Save (${assignSelected.size} clients)`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// COMPANY INFORMATION MODAL
// ============================================================
function CompanyInfoModal({ companyData, setCompanyData, onClose, onClientCreate, clientId, accounts, isAdmin }) {
  const [localData, setLocalData] = useState({ ...companyData, contacts: [...(companyData.contacts || [])], addresses: [...(companyData.addresses || [])] })
  const [localAccountId, setLocalAccountId] = useState(companyData.account_id || '')
  const [localIntellagentic, setLocalIntellagentic] = useState(companyData.intellagentic_lead || false)
  const [localContacts, setLocalContacts] = useState(() => {
    const c = companyData.contacts || []
    return c.map(ct => ({ ...ct }))
  })
  const [localAddresses, setLocalAddresses] = useState(() => {
    const a = companyData.addresses || []
    return a.map(addr => ({ ...addr }))
  })

  const addContact = () => {
    setLocalContacts(prev => [...prev, { firstName: '', lastName: '', title: '', email: '', phone: '', linkedin: '', photo_url: '' }])
  }
  const updateContact = (index, field, value) => {
    setLocalContacts(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c))
  }
  const removeContact = (index) => {
    setLocalContacts(prev => prev.filter((_, i) => i !== index))
  }

  const addLocalAddress = () => {
    setLocalAddresses(prev => [...prev, { label: '', address1: '', address2: '', city: '', state: '', postalCode: '', country: '' }])
  }
  const updateLocalAddress = (index, field, value) => {
    setLocalAddresses(prev => prev.map((a, i) => i === index ? { ...a, [field]: value } : a))
  }
  const removeLocalAddress = (index) => {
    setLocalAddresses(prev => prev.filter((_, i) => i !== index))
  }
  const [localPainPoints, setLocalPainPoints] = useState(() => {
    const pts = companyData.painPoints || []
    return pts.length > 0 ? [...pts] : ['']
  })
  const [modalContactsExpanded, setModalContactsExpanded] = useState(false)
  const [modalAddressesExpanded, setModalAddressesExpanded] = useState(false)
  const [logoUrl, setLogoUrl] = useState(companyData.logoUrl || null)
  const [iconUrl, setIconUrl] = useState(companyData.iconUrl || null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingIcon, setUploadingIcon] = useState(false)

  // Load branding URLs on mount if we have a clientId
  useEffect(() => {
    if (clientId) {
      fetch(`${API_BASE}/upload/branding?client_id=${clientId}`, { headers: getAuthHeaders() })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            if (data.logo_url) setLogoUrl(data.logo_url)
            if (data.icon_url) setIconUrl(data.icon_url)
          }
        })
        .catch(() => {})
    }
  }, [clientId])

  const handleBrandingUpload = async (file, fileType) => {
    if (!clientId) {
      alert('Please save partner information first to enable branding uploads.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('File must be under 2MB')
      return
    }
    const ext = file.name.split('.').pop().toLowerCase()
    const contentTypeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp' }
    const contentType = contentTypeMap[ext]
    if (!contentType) {
      alert('Supported formats: PNG, JPG, SVG, WebP')
      return
    }

    const setUploading = fileType === 'logo' ? setUploadingLogo : setUploadingIcon
    setUploading(true)

    try {
      // Get presigned URL
      const res = await fetch(`${API_BASE}/upload/branding`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ client_id: clientId, file_type: fileType, content_type: contentType, file_extension: ext })
      })
      if (!res.ok) throw new Error('Failed to get upload URL')
      const { upload_url } = await res.json()

      // Upload file to S3
      await fetch(upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file
      })

      // Fetch fresh presigned GET URL
      const brandingRes = await fetch(`${API_BASE}/upload/branding?client_id=${clientId}`, { headers: getAuthHeaders() })
      if (brandingRes.ok) {
        const data = await brandingRes.json()
        if (fileType === 'logo' && data.logo_url) {
          setLogoUrl(data.logo_url)
          setCompanyData(prev => ({ ...prev, logoUrl: data.logo_url }))
        }
        if (fileType === 'icon' && data.icon_url) {
          setIconUrl(data.icon_url)
          setCompanyData(prev => ({ ...prev, iconUrl: data.icon_url }))
        }
      }
    } catch (err) {
      console.error(`Failed to upload ${fileType}:`, err)
      alert(`Failed to upload ${fileType}. Please try again.`)
    }
    setUploading(false)
  }

  const handleSave = () => {
    if (!localData.name.trim()) {
      alert('Company name is required')
      return
    }
    const filteredPainPoints = localPainPoints.filter(p => p.trim())
    const saveData = { ...localData, contacts: localContacts, addresses: localAddresses, account_id: localAccountId ? parseInt(localAccountId) : null, intellagentic_lead: localIntellagentic, painPoints: filteredPainPoints }
    setCompanyData(prev => ({ ...saveData, logoUrl: prev.logoUrl, iconUrl: prev.iconUrl }))
    if (onClientCreate) onClientCreate(saveData)
    onClose()
  }

  // ── Unsaved changes protection ──
  const hasUnsavedChanges = localData.name.trim() !== '' || localContacts.some(c => c.firstName || c.lastName || c.email) || localAddresses.some(a => a.address1 || a.city) || localData.website.trim() !== '' || (localData.company_linkedin || '').trim() !== '' || localData.industry.trim() !== '' || localData.description.trim() !== ''

  const guardedClose = () => {
    if (hasUnsavedChanges) {
      if (!window.confirm('You have unsaved changes. Are you sure you want to close?')) return
    }
    onClose()
  }

  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasUnsavedChanges])

  const brandingDropZoneStyle = {
    border: '2px dashed var(--border-color)',
    borderRadius: '8px',
    padding: '1rem',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.2s',
    position: 'relative',
    minHeight: '80px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: '0.5rem'
  }

  return (
    <div className="modal-overlay" onClick={guardedClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Building2 size={20} className="icon-red" />
            <h2>Client Information</h2>
          </div>
          <button className="modal-close" onClick={guardedClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gap: '1rem' }}>
            {/* Company Name */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                Company Name *
              </label>
              <input
                type="text"
                value={localData.name}
                onChange={(e) => setLocalData({ ...localData, name: e.target.value })}
                placeholder="Enter company name"
                style={{
                  width: '100%',
                  padding: '0.625rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            {/* Website URL */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                Website URL
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="url"
                  value={localData.website}
                  onChange={(e) => setLocalData({ ...localData, website: e.target.value })}
                  placeholder="https://example.com"
                  style={{
                    flex: 1,
                    padding: '0.625rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontFamily: 'inherit'
                  }}
                />
                {localData.website && (
                  <a href={localData.website.startsWith('http') ? localData.website : `https://${localData.website}`} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--accent-color, #3b82f6)', padding: '0.375rem', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title="Open website">
                    <ExternalLink size={16} />
                  </a>
                )}
              </div>
            </div>

            {/* Company LinkedIn */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                Company LinkedIn
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  type="url"
                  value={localData.company_linkedin || ''}
                  onChange={(e) => setLocalData({ ...localData, company_linkedin: e.target.value })}
                  placeholder="https://www.linkedin.com/company/..."
                  style={{
                    flex: 1,
                    padding: '0.625rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontFamily: 'inherit'
                  }}
                />
                {localData.company_linkedin && (
                  <a href={localData.company_linkedin.startsWith('http') ? localData.company_linkedin : `https://${localData.company_linkedin}`} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--accent-color, #3b82f6)', padding: '0.375rem', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title="Open LinkedIn page">
                    <ExternalLink size={16} />
                  </a>
                )}
              </div>
            </div>

            {/* Contacts Section */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Contacts
                </label>
                <button
                  type="button"
                  onClick={addContact}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 500,
                    background: 'var(--accent-color, #3b82f6)', color: '#fff',
                    border: 'none', borderRadius: '6px', cursor: 'pointer'
                  }}
                >
                  <Plus size={14} /> Add Contact
                </button>
              </div>

              {localContacts.length === 0 && (
                <div style={{
                  border: '2px dashed var(--border-color)', borderRadius: '8px',
                  padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)'
                }}>
                  <User size={24} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                  <div style={{ fontSize: '0.85rem' }}>No contacts added yet</div>
                  <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Click "Add Contact" to add a primary contact</div>
                </div>
              )}

              {localContacts.map((contact, idx) => (idx > 0 && !modalContactsExpanded) ? null : (
                <div key={idx} style={{
                  border: '1px solid var(--border-color)', borderRadius: '8px',
                  padding: '0.75rem', marginBottom: '0.75rem'
                }}>
                  {/* Contact card header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: idx === 0 ? 'var(--accent-color, #3b82f6)' : 'var(--text-secondary)' }}>
                      {idx === 0 ? 'Primary Contact' : `Contact ${idx + 1}`}
                    </span>
                    <button type="button" onClick={() => removeContact(idx)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px' }}
                      title="Remove contact"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      <input type="text" value={contact.firstName || ''} onChange={(e) => updateContact(idx, 'firstName', e.target.value)}
                        placeholder="First Name" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                      <input type="text" value={contact.lastName || ''} onChange={(e) => updateContact(idx, 'lastName', e.target.value)}
                        placeholder="Last Name" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                    </div>
                    {localData.name && (
                      <div style={{ padding: '0.5rem', background: 'var(--bg-secondary, #f3f4f6)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {localData.name}
                      </div>
                    )}
                    <input type="text" value={contact.title} onChange={(e) => updateContact(idx, 'title', e.target.value)}
                      placeholder="Title / Role" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      <input type="email" value={contact.email} onChange={(e) => updateContact(idx, 'email', e.target.value)}
                        placeholder="Email" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <select value={splitPhone(contact.phone).countryCode} aria-label="Country code" onChange={(e) => updateContact(idx, 'phone', joinPhone(e.target.value, splitPhone(contact.phone).number))}
                          style={{ width: '80px', flexShrink: 0, padding: '0.5rem 0.2rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }}>
                          {COUNTRY_CODES.map(cc => <option key={cc.code} value={cc.code}>{cc.code}</option>)}
                        </select>
                        <input type="tel" value={splitPhone(contact.phone).number} onChange={(e) => updateContact(idx, 'phone', joinPhone(splitPhone(contact.phone).countryCode, e.target.value))}
                          placeholder="Phone" style={{ flex: 1, padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                      </div>
                    </div>
                    <input type="url" value={contact.linkedin} onChange={(e) => updateContact(idx, 'linkedin', e.target.value)}
                      placeholder="LinkedIn URL" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                  </div>
                </div>
              ))}

              {localContacts.length > 1 && (
                <button
                  type="button"
                  onClick={() => setModalContactsExpanded(prev => !prev)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                    padding: '0.25rem 0', fontSize: '0.8rem', fontWeight: 600,
                    color: 'var(--accent-color, #3b82f6)'
                  }}
                >
                  {modalContactsExpanded ? (
                    <><ChevronUp size={14} /> Hide {localContacts.length - 1} more contact{localContacts.length - 1 > 1 ? 's' : ''}</>
                  ) : (
                    <><ChevronDown size={14} /> View {localContacts.length - 1} more contact{localContacts.length - 1 > 1 ? 's' : ''}</>
                  )}
                </button>
              )}
            </div>

            {/* Addresses Section */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Addresses
                </label>
                <button
                  type="button"
                  onClick={addLocalAddress}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 500,
                    background: 'var(--accent-color, #3b82f6)', color: '#fff',
                    border: 'none', borderRadius: '6px', cursor: 'pointer'
                  }}
                >
                  <Plus size={14} /> Add Address
                </button>
              </div>

              {localAddresses.length === 0 && (
                <div style={{
                  border: '2px dashed var(--border-color)', borderRadius: '8px',
                  padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)'
                }}>
                  <MapPin size={24} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                  <div style={{ fontSize: '0.85rem' }}>No addresses added yet</div>
                  <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>Click "Add Address" to add a location</div>
                </div>
              )}

              {localAddresses.map((addr, idx) => (idx > 0 && !modalAddressesExpanded) ? null : (
                <div key={idx} style={{
                  border: '1px solid var(--border-color)', borderRadius: '8px',
                  padding: '0.75rem', marginBottom: '0.75rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: idx === 0 ? 'var(--accent-color, #3b82f6)' : 'var(--text-secondary)' }}>
                      {idx === 0 ? 'Primary Address' : `Address ${idx + 1}`}
                    </span>
                    <button type="button" onClick={() => removeLocalAddress(idx)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px' }}
                      title="Remove address"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <input type="text" value={addr.label || ''} onChange={(e) => updateLocalAddress(idx, 'label', e.target.value)}
                      placeholder="Label (e.g., Headquarters, Warehouse)" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                    <input type="text" value={addr.address1 || ''} onChange={(e) => updateLocalAddress(idx, 'address1', e.target.value)}
                      placeholder="Address Line 1" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                    <input type="text" value={addr.address2 || ''} onChange={(e) => updateLocalAddress(idx, 'address2', e.target.value)}
                      placeholder="Address Line 2" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                      <input type="text" value={addr.city || ''} onChange={(e) => updateLocalAddress(idx, 'city', e.target.value)}
                        placeholder="City" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                      <input type="text" value={addr.state || ''} onChange={(e) => updateLocalAddress(idx, 'state', e.target.value)}
                        placeholder="State / Province" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                      <input type="text" value={addr.postalCode || ''} onChange={(e) => updateLocalAddress(idx, 'postalCode', e.target.value)}
                        placeholder="Postal Code" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                      <input type="text" value={addr.country || ''} onChange={(e) => updateLocalAddress(idx, 'country', e.target.value)}
                        placeholder="Country" style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.8rem', fontFamily: 'inherit' }} />
                    </div>
                  </div>
                </div>
              ))}

              {localAddresses.length > 1 && (
                <button
                  type="button"
                  onClick={() => setModalAddressesExpanded(prev => !prev)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                    padding: '0.25rem 0', fontSize: '0.8rem', fontWeight: 600,
                    color: 'var(--accent-color, #3b82f6)'
                  }}
                >
                  {modalAddressesExpanded ? (
                    <><ChevronUp size={14} /> Hide {localAddresses.length - 1} more address{localAddresses.length - 1 > 1 ? 'es' : ''}</>
                  ) : (
                    <><ChevronDown size={14} /> View {localAddresses.length - 1} more address{localAddresses.length - 1 > 1 ? 'es' : ''}</>
                  )}
                </button>
              )}
            </div>

            {/* Industry */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                Industry/Vertical
              </label>
              <input
                type="text"
                value={localData.industry}
                onChange={(e) => setLocalData({ ...localData, industry: e.target.value })}
                placeholder="e.g., Waste Management, Healthcare, Hospitality"
                style={{
                  width: '100%',
                  padding: '0.625rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            {/* Channel Partner (admin only) */}
            {isAdmin && accounts && accounts.length > 0 && (
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                  Channel Partner
                </label>
                <select aria-label="Channel partner"
                  value={localAccountId}
                  onChange={(e) => setLocalAccountId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.625rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontFamily: 'inherit',
                    background: 'var(--bg-input, #ffffff)',
                    color: 'var(--text-primary)'
                  }}
                >
                  <option value="">None</option>
                  {accounts.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.company && p.company !== p.name ? ` — ${p.company}` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Intellagentic Lead (admin only) */}
            {isAdmin && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  id="intellagentic-lead"
                  checked={localIntellagentic}
                  onChange={(e) => setLocalIntellagentic(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#dc2626' }}
                />
                <label htmlFor="intellagentic-lead" style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)', cursor: 'pointer' }}>
                  Intellagentic Lead
                </label>
              </div>
            )}

            {/* Current Business Description */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                Current Business Description
              </label>
              <textarea
                value={localData.description}
                onChange={(e) => setLocalData({ ...localData, description: e.target.value })}
                placeholder="Brief description of the business"
                rows={4}
                style={{
                  width: '100%',
                  padding: '0.625rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  minHeight: '100px'
                }}
              />
            </div>

            {/* Future Plans */}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                Future Plans
              </label>
              <textarea
                value={localData.futurePlans || ''}
                onChange={(e) => setLocalData({ ...localData, futurePlans: e.target.value })}
                placeholder="Where is the business heading? Growth plans, strategic goals..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '0.625rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  minHeight: '100px'
                }}
              />
            </div>

            {/* Pain Points */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                  Pain Points
                </label>
                <button
                  type="button"
                  onClick={() => setLocalPainPoints(prev => [...prev, ''])}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    padding: '0.35rem 0.75rem', fontSize: '0.8rem', fontWeight: 500,
                    background: 'var(--accent-color, #3b82f6)', color: '#fff',
                    border: 'none', borderRadius: '6px', cursor: 'pointer'
                  }}
                >
                  <Plus size={14} /> Add
                </button>
              </div>
              {localPainPoints.map((point, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <textarea
                    value={point}
                    onChange={(e) => setLocalPainPoints(prev => prev.map((p, i) => i === idx ? e.target.value : p))}
                    placeholder={`Pain point ${idx + 1}...`}
                    rows={4}
                    style={{
                      flex: 1,
                      padding: '0.625rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      fontSize: '0.875rem',
                      fontFamily: 'inherit',
                      resize: 'vertical',
                      minHeight: '100px'
                    }}
                  />
                  {localPainPoints.length > 1 && (
                    <button type="button" onClick={() => setLocalPainPoints(prev => prev.filter((_, i) => i !== idx))}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '0.5rem' }} title="Remove">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Client Branding Section */}
            <div style={{
              borderTop: '1px solid var(--border-color)',
              paddingTop: '1rem',
              marginTop: '0.5rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <Image size={16} style={{ color: '#dc2626' }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Client Branding</span>
              </div>
              {!clientId && (
                <p style={{ fontSize: '0.85rem', fontStyle: 'italic', color: '#d97706', margin: '0 0 0.75rem 0' }}>
                  Save client first to enable logo and icon uploads
                </p>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {/* Logo Upload */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>
                    Company Logo
                  </label>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted, #6b7280)', marginBottom: '0.5rem' }}>
                    400x100px, PNG/SVG, transparent bg
                  </p>
                  <div
                    style={{
                      ...brandingDropZoneStyle,
                      opacity: clientId ? 1 : 0.5,
                      pointerEvents: clientId ? 'auto' : 'none'
                    }}
                    onClick={() => {
                      if (!clientId) return
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.accept = '.png,.jpg,.jpeg,.svg,.webp'
                      input.onchange = (e) => {
                        if (e.target.files[0]) handleBrandingUpload(e.target.files[0], 'logo')
                      }
                      input.click()
                    }}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#dc2626' }}
                    onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)' }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.currentTarget.style.borderColor = 'var(--border-color)'
                      if (e.dataTransfer.files[0]) handleBrandingUpload(e.dataTransfer.files[0], 'logo')
                    }}
                  >
                    {uploadingLogo ? (
                      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: '#dc2626' }} />
                    ) : logoUrl ? (
                      <img src={logoUrl} alt="Logo" style={{ maxHeight: '50px', maxWidth: '100%', objectFit: 'contain' }} />
                    ) : (
                      <>
                        <Upload size={18} style={{ color: 'var(--text-muted, #9ca3af)' }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)' }}>Drop logo or click</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Icon Upload */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>
                    Company Icon
                  </label>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted, #6b7280)', marginBottom: '0.5rem' }}>
                    128x128px, PNG/SVG, square
                  </p>
                  <div
                    style={{
                      ...brandingDropZoneStyle,
                      opacity: clientId ? 1 : 0.5,
                      pointerEvents: clientId ? 'auto' : 'none'
                    }}
                    onClick={() => {
                      if (!clientId) return
                      const input = document.createElement('input')
                      input.type = 'file'
                      input.accept = '.png,.jpg,.jpeg,.svg,.webp'
                      input.onchange = (e) => {
                        if (e.target.files[0]) handleBrandingUpload(e.target.files[0], 'icon')
                      }
                      input.click()
                    }}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#dc2626' }}
                    onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)' }}
                    onDrop={(e) => {
                      e.preventDefault()
                      e.currentTarget.style.borderColor = 'var(--border-color)'
                      if (e.dataTransfer.files[0]) handleBrandingUpload(e.dataTransfer.files[0], 'icon')
                    }}
                  >
                    {uploadingIcon ? (
                      <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: '#dc2626' }} />
                    ) : iconUrl ? (
                      <img src={iconUrl} alt="Icon" style={{ width: '48px', height: '48px', objectFit: 'contain', borderRadius: '8px' }} />
                    ) : (
                      <>
                        <Upload size={18} style={{ color: 'var(--text-muted, #9ca3af)' }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)' }}>Drop icon or click</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            className="action-btn red"
            style={{
              width: '100%',
              marginTop: '1.5rem',
              justifyContent: 'center'
            }}
          >
            Save Client Information
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// BRANDING SCREEN
// ============================================================
function BrandingScreen({ clientId, companyData, setCompanyData }) {
  const [logoUrl, setLogoUrl] = useState(companyData.logoUrl || null)
  const [iconUrl, setIconUrl] = useState(companyData.iconUrl || null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (clientId) {
      fetch(`${API_BASE}/upload/branding?client_id=${clientId}`, { headers: getAuthHeaders() })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            if (data.logo_url) setLogoUrl(data.logo_url)
            if (data.icon_url) setIconUrl(data.icon_url)
          }
        })
        .catch(() => {})
        .finally(() => setLoaded(true))
    } else {
      setLoaded(true)
    }
  }, [clientId])

  const handleUpload = async (file, fileType) => {
    if (!clientId) return
    if (file.size > 2 * 1024 * 1024) {
      alert('File must be under 2MB')
      return
    }
    const ext = file.name.split('.').pop().toLowerCase()
    const contentTypeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp' }
    const contentType = contentTypeMap[ext]
    if (!contentType) {
      alert('Supported formats: PNG, JPG, SVG, WebP')
      return
    }

    const setUploading = fileType === 'logo' ? setUploadingLogo : setUploadingIcon
    setUploading(true)

    try {
      const res = await fetch(`${API_BASE}/upload/branding`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ client_id: clientId, file_type: fileType, content_type: contentType, file_extension: ext })
      })
      if (!res.ok) throw new Error('Failed to get upload URL')
      const { upload_url } = await res.json()

      await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file })

      const brandingRes = await fetch(`${API_BASE}/upload/branding?client_id=${clientId}`, { headers: getAuthHeaders() })
      if (brandingRes.ok) {
        const data = await brandingRes.json()
        if (fileType === 'logo' && data.logo_url) {
          setLogoUrl(data.logo_url)
          setCompanyData(prev => ({ ...prev, logoUrl: data.logo_url }))
        }
        if (fileType === 'icon' && data.icon_url) {
          setIconUrl(data.icon_url)
          setCompanyData(prev => ({ ...prev, iconUrl: data.icon_url }))
        }
      }
    } catch (err) {
      console.error(`Failed to upload ${fileType}:`, err)
      alert(`Failed to upload ${fileType}. Please try again.`)
    }
    setUploading(false)
  }

  const dropZoneBase = {
    border: '2px dashed var(--border-color)',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'border-color 0.2s, background 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: '0.75rem',
    position: 'relative'
  }

  const makeDropHandlers = (fileType) => ({
    onClick: () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.png,.jpg,.jpeg,.svg,.webp'
      input.onchange = (e) => { if (e.target.files[0]) handleUpload(e.target.files[0], fileType) }
      input.click()
    },
    onDragOver: (e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#dc2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.04)' },
    onDragLeave: (e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'transparent' },
    onDrop: (e) => {
      e.preventDefault()
      e.currentTarget.style.borderColor = 'var(--border-color)'
      e.currentTarget.style.background = 'transparent'
      if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0], fileType)
    }
  })

  if (!clientId) {
    return (
      <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <Image size={48} style={{ color: 'var(--text-muted, #9ca3af)', margin: '0 auto 1rem' }} />
        <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No Client Selected</h3>
        <p style={{ color: 'var(--text-muted, #6b7280)' }}>Create or select a client first to manage branding assets.</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '700px', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Image size={22} style={{ color: '#dc2626' }} />
          Client Branding
        </h2>
        <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
          Upload a logo and icon for <strong>{companyData.name || 'this client'}</strong>. These appear on the dashboard, workspace header, and Streamline webhook.
        </p>
      </div>

      {/* Company Logo */}
      <div style={{
        background: 'var(--bg-primary, #ffffff)',
        border: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.25rem'
      }}>
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Company Logo</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)', marginTop: '0.25rem' }}>
            Recommended: 400x100px, PNG or SVG with transparent background. Max 2MB.
          </p>
        </div>
        <div style={{ ...dropZoneBase, padding: '2rem', minHeight: '120px' }} {...makeDropHandlers('logo')}>
          {uploadingLogo ? (
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#dc2626' }} />
          ) : logoUrl ? (
            <div style={{ textAlign: 'center' }}>
              <img src={logoUrl} alt="Logo" style={{ maxHeight: '80px', maxWidth: '100%', objectFit: 'contain' }} />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)', marginTop: '0.75rem' }}>Click or drop to replace</p>
            </div>
          ) : (
            <>
              <Upload size={28} style={{ color: 'var(--text-muted, #9ca3af)' }} />
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted, #9ca3af)' }}>Drop logo here or click to browse</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #b0b0b0)' }}>PNG, JPG, SVG, or WebP</span>
            </>
          )}
        </div>
      </div>

      {/* Company Icon */}
      <div style={{
        background: 'var(--bg-primary, #ffffff)',
        border: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: '12px',
        padding: '1.5rem',
        marginBottom: '1.25rem'
      }}>
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Company Icon</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)', marginTop: '0.25rem' }}>
            Recommended: 128x128px, PNG or SVG, square format. Shown on dashboard cards. Max 2MB.
          </p>
        </div>
        <div style={{ ...dropZoneBase, padding: '2rem', minHeight: '120px' }} {...makeDropHandlers('icon')}>
          {uploadingIcon ? (
            <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#dc2626' }} />
          ) : iconUrl ? (
            <div style={{ textAlign: 'center' }}>
              <img src={iconUrl} alt="Icon" style={{ width: '80px', height: '80px', objectFit: 'contain', borderRadius: '12px' }} />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)', marginTop: '0.75rem' }}>Click or drop to replace</p>
            </div>
          ) : (
            <>
              <Upload size={28} style={{ color: 'var(--text-muted, #9ca3af)' }} />
              <span style={{ fontSize: '0.875rem', color: 'var(--text-muted, #9ca3af)' }}>Drop icon here or click to browse</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted, #b0b0b0)' }}>PNG, JPG, SVG, or WebP</span>
            </>
          )}
        </div>
      </div>

      {/* Preview */}
      {(logoUrl || iconUrl) && (
        <div style={{
          background: 'var(--bg-primary, #ffffff)',
          border: '1px solid var(--border-color, #e5e7eb)',
          borderRadius: '12px',
          padding: '1.5rem'
        }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 1rem' }}>Preview</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {logoUrl && (
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Header Logo</span>
                <div style={{ marginTop: '0.5rem', background: '#1a1a2e', borderRadius: '8px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div style={{ width: '28px', height: '28px', background: '#dc2626', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '0.7rem', fontWeight: 800 }}>XO</div>
                  <img src={logoUrl} alt="" style={{ height: '20px', maxWidth: '120px', objectFit: 'contain' }} />
                </div>
              </div>
            )}
            {iconUrl && (
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted, #6b7280)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dashboard Card Icon</span>
                <div style={{ marginTop: '0.5rem', background: 'var(--bg-secondary, #f9fafb)', borderRadius: '8px', padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                  <img src={iconUrl} alt="" style={{ width: '32px', height: '32px', objectFit: 'contain', borderRadius: '8px' }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{companyData.name || 'Company Name'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


// ============================================================
// UPLOAD SCREEN
// ============================================================
function UploadScreen({ setClientId, clientId, companyData, setCompanyData, onClientCreate, onComplete, onOpenCompanyModal, configButtons, systemButtons, onNavigate, isAdmin, isAccount, onSelectClient, accounts, engagements, setEngagements, activeEngagement, setActiveEngagement, teamUsers }) {
  const [error, setError] = useState(null)
  const [sourceCount, setSourceCount] = useState(0)
  const [activeCount, setActiveCount] = useState(0)
  const [showEngagementModal, setShowEngagementModal] = useState(false)
  const [editEngagement, setEditEngagement] = useState(null)
  const [engagementSaving, setEngagementSaving] = useState(false)

  // Inline form state
  const [formData, setFormData] = useState({
    name: companyData.name || '',
    ndaSigned: companyData.ndaSigned || false,
    ndaSignedAt: companyData.ndaSignedAt || '',
    updated_at: companyData.updated_at || '',
    existingApps: companyData.existingApps || '',
    website: companyData.website || '',
    company_linkedin: companyData.company_linkedin || '',
    industry: companyData.industry || '',
    description: companyData.description || '',
    painPoint: companyData.painPoint || '',
    futurePlans: companyData.futurePlans || '',
    intellagentic_lead: companyData.intellagentic_lead || false,
    account_id: companyData.account_id || null
  })
  const [formPainPoints, setFormPainPoints] = useState(() => {
    const pts = companyData.painPoints || []
    return pts.length > 0 ? [...pts] : ['']
  })
  const [formContacts, setFormContacts] = useState(() =>
    (companyData.contacts || []).map(c => ({ ...c }))
  )
  const [formAddresses, setFormAddresses] = useState(() =>
    (companyData.addresses || []).map(a => ({ ...a }))
  )
  const [saving, setSaving] = useState(false)
  const [savedIndicator, setSavedIndicator] = useState(false)
  const [contactsExpanded, setContactsExpanded] = useState(false)
  const [addressesExpanded, setAddressesExpanded] = useState(false)
  const [existingAppsEdit, setExistingAppsEdit] = useState(false)
  const [photoPopover, setPhotoPopover] = useState(null) // contact index or null
  const [photoUrlInput, setPhotoUrlInput] = useState('')
  const [contactPhotoCache, setContactPhotoCache] = useState({}) // s3_key -> presigned display URL

  // Sync form when companyData changes externally (e.g. client switch)
  useEffect(() => {
    setFormData({
      name: companyData.name || '',
      ndaSigned: companyData.ndaSigned || false,
      ndaSignedAt: companyData.ndaSignedAt || '',
      updated_at: companyData.updated_at || '',
      existingApps: companyData.existingApps || '',
      website: companyData.website || '',
      company_linkedin: companyData.company_linkedin || '',
      industry: companyData.industry || '',
      description: companyData.description || '',
      painPoint: companyData.painPoint || '',
      futurePlans: companyData.futurePlans || '',
      intellagentic_lead: companyData.intellagentic_lead || false,
      account_id: companyData.account_id || null
    })
    const pts = companyData.painPoints || []
    setFormPainPoints(pts.length > 0 ? [...pts] : [''])
    setFormContacts((companyData.contacts || []).map(c => ({ ...c })))
    setFormAddresses((companyData.addresses || []).map(a => ({ ...a })))
  }, [companyData.name, clientId])

  const addContact = () => {
    setFormContacts(prev => [...prev, { firstName: '', lastName: '', title: '', email: '', phone: '', linkedin: '', photo_url: '' }])
  }
  const updateContact = (index, field, value) => {
    setFormContacts(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c))
  }
  const removeContact = (index) => {
    setFormContacts(prev => prev.filter((_, i) => i !== index))
  }

  const addAddress = () => {
    setFormAddresses(prev => [...prev, { label: '', address1: '', address2: '', city: '', state: '', postalCode: '', country: '' }])
  }
  const updateAddress = (index, field, value) => {
    setFormAddresses(prev => prev.map((a, i) => i === index ? { ...a, [field]: value } : a))
  }
  const removeAddress = (index) => {
    setFormAddresses(prev => prev.filter((_, i) => i !== index))
  }

  // Autosave: called on blur from any form field, or with overrides for immediate-toggle fields
  const autoSave = async (overrides, contactsOverride) => {
    const current = overrides ? { ...formData, ...overrides } : formData
    if (!current.name.trim()) return
    setSaving(true)
    const filteredPainPoints = formPainPoints.filter(p => p.trim())
    const saveData = { ...current, contacts: contactsOverride || formContacts, addresses: formAddresses, painPoints: filteredPainPoints }
    setCompanyData(prev => ({ ...prev, ...saveData }))
    if (onClientCreate) await onClientCreate(saveData)
    setSaving(false)
    setSavedIndicator(true)
    setExistingAppsEdit(false)
    setTimeout(() => setSavedIndicator(false), 2000)
  }

  // Fetch source counts when clientId is available
  useEffect(() => {
    if (clientId) {
      fetchSourceCounts()
    }
  }, [clientId])

  const fetchSourceCounts = async () => {
    try {
      const res = await fetch(`${API_BASE}/uploads?client_id=${clientId}`, {
        headers: getAuthHeaders()
      })
      if (res.ok) {
        const data = await res.json()
        const uploads = data.uploads || []
        setSourceCount(uploads.length)
        setActiveCount(uploads.filter(u => u.status === 'active').length)
      }
    } catch (err) {
      console.error('Failed to fetch source counts:', err)
    }
  }

  const step1Complete = !!companyData.name
  const step2Complete = sourceCount > 0
  const allStepsComplete = step1Complete && step2Complete

  return (
    <div>
      {/* Two-Column Split Layout */}
      <div className="workspace-columns" style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1rem',
        alignItems: 'flex-start'
      }}>

        {/* LEFT COLUMN — Partner Information Form (always editable, light theme) */}
        <div className="workspace-col-left" style={{
          flex: '0 0 38%',
          minWidth: '280px',
          background: '#ffffff',
          borderRadius: '12px',
          padding: '1.25rem',
          border: '1px solid #e0e0e0',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.875rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <Building2 size={18} style={{ color: '#dc2626' }} />
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1a1a2e', margin: 0 }}>
              ORGANIZATION PROFILE
            </h3>
          </div>

          {/* Company Name */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Company Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              onBlur={autoSave}
              placeholder="Enter company name"
              style={{
                width: '100%', padding: '0.5rem 0.625rem',
                background: '#f9fafb',
                border: '1px solid #d1d5db',
                borderRadius: '6px', fontSize: '0.85rem', color: '#111827',
                fontFamily: 'inherit', outline: 'none'
              }}
            />
          </div>

          {/* Website URL */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Website URL
            </label>
            <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
              <input
                type="url"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                onBlur={autoSave}
                placeholder="https://example.com"
                style={{
                  flex: 1, padding: '0.5rem 0.625rem',
                  background: '#f9fafb',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px', fontSize: '0.85rem', color: '#111827',
                  fontFamily: 'inherit', outline: 'none'
                }}
              />
              {formData.website && (
                <a href={formData.website.startsWith('http') ? formData.website : `https://${formData.website}`} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#dc2626', padding: '0.25rem', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Open website">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>

          {/* Company LinkedIn */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Company LinkedIn
            </label>
            <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
              <input
                type="url"
                value={formData.company_linkedin}
                onChange={(e) => setFormData({ ...formData, company_linkedin: e.target.value })}
                onBlur={autoSave}
                placeholder="https://www.linkedin.com/company/..."
                style={{
                  flex: 1, padding: '0.5rem 0.625rem',
                  background: '#f9fafb',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px', fontSize: '0.85rem', color: '#111827',
                  fontFamily: 'inherit', outline: 'none'
                }}
              />
              {formData.company_linkedin && (
                <a href={formData.company_linkedin.startsWith('http') ? formData.company_linkedin : `https://${formData.company_linkedin}`} target="_blank" rel="noopener noreferrer"
                  style={{ color: '#dc2626', padding: '0.25rem', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Open LinkedIn page">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          </div>

          {/* ── ENGAGEMENTS SECTION ── */}
          {clientId && (
            <div style={{ marginTop: '0.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Package size={16} style={{ color: '#dc2626' }} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Engagements</span>
                  <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>({engagements.length})</span>
                </div>
                <button
                  onClick={() => setShowEngagementModal(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer' }}>
                  <Plus size={12} /> New
                </button>
              </div>

              {activeEngagement && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', padding: '0.35rem 0.5rem', background: 'rgba(220,38,38,0.1)', borderRadius: 6, border: '1px solid rgba(220,38,38,0.2)' }}>
                  <span style={{ fontSize: '0.7rem', color: '#dc2626', fontWeight: 600 }}>Active:</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-primary)', fontWeight: 600 }}>{activeEngagement.name}</span>
                  <button onClick={() => { setActiveEngagement(null); sessionStorage.removeItem('xo-engagement-' + clientId) }} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '0.65rem' }}>Clear</button>
                </div>
              )}

              {engagements.length === 0 ? (
                <div style={{ border: '1px dashed #d1d5db', borderRadius: 8, padding: '0.75rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.75rem' }}>
                  No engagements yet. Create one to scope enrichment to a specific focus area.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {engagements.map(eng => {
                    const isSelected = activeEngagement?.id === eng.id
                    return (
                    <div key={eng.id}
                      onClick={() => { setActiveEngagement(isSelected ? null : eng); if (isSelected) { sessionStorage.removeItem('xo-engagement-' + clientId) } else { sessionStorage.setItem('xo-engagement-' + clientId, eng.id) } }}
                      style={{
                        padding: '0.5rem 0.625rem', borderRadius: 8, cursor: 'pointer',
                        border: isSelected ? '2px solid #dc2626' : '1px solid #e5e7eb',
                        background: isSelected ? 'rgba(220,38,38,0.05)' : '#f9fafb',
                        transition: 'all 0.15s'
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          {isSelected && <CheckCircle size={14} style={{ color: '#dc2626', flexShrink: 0 }} />}
                          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{eng.name}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          {isSelected ? (
                            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.35rem', borderRadius: 4, background: '#dc2626', color: '#fff' }}>SELECTED</span>
                          ) : (
                            <span style={{ fontSize: '0.6rem', color: '#9ca3af', fontStyle: 'italic' }}>Click to select</span>
                          )}
                          <span style={{
                            fontSize: '0.55rem', fontWeight: 500, padding: '0.1rem 0.35rem', borderRadius: 4,
                            background: eng.status === 'won' ? '#dcfce7' : eng.status === 'lost' ? '#fee2e2' : eng.status === 'paused' ? '#fef3c7' : '#f3f4f6',
                            color: eng.status === 'won' ? '#16a34a' : eng.status === 'lost' ? '#dc2626' : eng.status === 'paused' ? '#d97706' : '#9ca3af'
                          }}>{{ active: 'Open', won: 'WON', lost: 'LOST', paused: 'PAUSED' }[eng.status] || 'Open'}</span>
                          <button onClick={(e) => { e.stopPropagation(); setEditEngagement(eng); setShowEngagementModal(true) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '0.1rem' }}>
                            <Edit2 size={12} />
                          </button>
                        </div>
                      </div>
                      {eng.focus_area && <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: '0.15rem' }}>{eng.focus_area.length > 80 ? eng.focus_area.substring(0, 80) + '...' : eng.focus_area}</div>}
                      {eng.contacts && eng.contacts.length > 0 && <div style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: '0.15rem' }}>{eng.contacts.length} contact{eng.contacts.length !== 1 ? 's' : ''}</div>}
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Industry */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Industry / Vertical
            </label>
            <input
              type="text"
              value={formData.industry}
              onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
              onBlur={autoSave}
              placeholder="e.g., Waste Management, Healthcare"
              style={{
                width: '100%', padding: '0.5rem 0.625rem',
                background: '#f9fafb',
                border: '1px solid #d1d5db',
                borderRadius: '6px', fontSize: '0.85rem', color: '#111827',
                fontFamily: 'inherit', outline: 'none'
              }}
            />
          </div>

          {/* Intellagentic Lead & Channel Partner — admin and partner only */}
          {(isAdmin || isAccount) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  Intellagentic Lead
                </label>
                <button
                  onClick={() => { const next = !formData.intellagentic_lead; setFormData(prev => ({ ...prev, intellagentic_lead: next })); autoSave({ intellagentic_lead: next }) }}
                  style={{
                    width: '100%', padding: '0.5rem 0.625rem',
                    background: formData.intellagentic_lead ? 'rgba(220, 38, 38, 0.08)' : '#f9fafb',
                    border: `1px solid ${formData.intellagentic_lead ? '#dc2626' : '#d1d5db'}`,
                    borderRadius: '6px', fontSize: '0.85rem',
                    color: formData.intellagentic_lead ? '#dc2626' : '#6b7280',
                    fontFamily: 'inherit', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500
                  }}
                >
                  {formData.intellagentic_lead ? <CheckCircle size={16} /> : <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #d1d5db' }} />}
                  {formData.intellagentic_lead ? 'Yes — Intellagentic Lead' : 'No'}
                </button>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  Channel Partner
                </label>
                <select aria-label="Channel partner"
                  value={formData.account_id || ''}
                  onChange={(e) => { const val = e.target.value ? parseInt(e.target.value) : null; setFormData(prev => ({ ...prev, account_id: val })); autoSave({ account_id: val }) }}
                  style={{
                    width: '100%', padding: '0.5rem 0.625rem',
                    background: '#f9fafb',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px', fontSize: '0.85rem', color: '#111827',
                    fontFamily: 'inherit', outline: 'none'
                  }}
                >
                  <option value="">No partner</option>
                  {(accounts || []).map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Current Business Description */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Current Business Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              onBlur={autoSave}
              placeholder="Brief description of the business"
              rows={4}
              style={{
                width: '100%', padding: '0.5rem 0.625rem',
                background: '#f9fafb',
                border: '1px solid #d1d5db',
                borderRadius: '6px', fontSize: '0.85rem', color: '#111827',
                fontFamily: 'inherit', outline: 'none', resize: 'vertical',
                minHeight: '100px'
              }}
            />
          </div>

          {/* Future Plans */}
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.3rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Future Plans
            </label>
            <textarea
              value={formData.futurePlans}
              onChange={(e) => setFormData({ ...formData, futurePlans: e.target.value })}
              onBlur={autoSave}
              placeholder="Where is the business heading? Growth plans, strategic goals..."
              rows={4}
              style={{
                width: '100%', padding: '0.5rem 0.625rem',
                background: '#f9fafb',
                border: '1px solid #d1d5db',
                borderRadius: '6px', fontSize: '0.85rem', color: '#111827',
                fontFamily: 'inherit', outline: 'none', resize: 'vertical',
                minHeight: '100px'
              }}
            />
          </div>

          {/* Pain Points */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Pain Points
              </label>
              <button
                type="button"
                onClick={() => setFormPainPoints(prev => [...prev, ''])}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                  padding: '0.2rem 0.5rem', fontSize: '0.7rem', fontWeight: 600,
                  background: 'rgba(220, 38, 38, 0.08)', color: '#dc2626',
                  border: '1px solid rgba(220, 38, 38, 0.25)', borderRadius: '4px', cursor: 'pointer'
                }}
              >
                <Plus size={12} /> Add
              </button>
            </div>
            {formPainPoints.map((point, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '0.375rem', alignItems: 'flex-start', marginBottom: '0.375rem' }}>
                <textarea
                  value={point}
                  onChange={(e) => setFormPainPoints(prev => prev.map((p, i) => i === idx ? e.target.value : p))}
                  onBlur={autoSave}
                  placeholder={`Pain point ${idx + 1}...`}
                  rows={4}
                  style={{
                    flex: 1, padding: '0.5rem 0.625rem',
                    background: '#f9fafb',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px', fontSize: '0.85rem', color: '#111827',
                    fontFamily: 'inherit', outline: 'none', resize: 'vertical',
                    minHeight: '100px'
                  }}
                />
                {formPainPoints.length > 1 && (
                  <button type="button" onClick={() => { setFormPainPoints(prev => prev.filter((_, i) => i !== idx)); setTimeout(autoSave, 0) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '0.375rem' }} title="Remove">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Divider */}
          <div style={{ height: '1px', background: '#e5e7eb' }} />

          {/* Contacts Section */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Contacts
              </label>
              <button
                type="button"
                onClick={addContact}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                  padding: '0.2rem 0.5rem', fontSize: '0.7rem', fontWeight: 600,
                  background: 'rgba(220, 38, 38, 0.08)', color: '#dc2626',
                  border: '1px solid rgba(220, 38, 38, 0.25)', borderRadius: '4px', cursor: 'pointer'
                }}
              >
                <Plus size={12} /> Add
              </button>
            </div>

            {formContacts.length === 0 && (
              <div style={{
                border: '1px dashed #d1d5db', borderRadius: '6px',
                padding: '0.75rem', textAlign: 'center', color: '#9ca3af',
                fontSize: '0.75rem'
              }}>
                No contacts yet
              </div>
            )}

            {formContacts.map((contact, idx) => (idx > 0 && !contactsExpanded) ? null : (
              <div key={idx} style={{
                border: '1px solid #e5e7eb', borderRadius: '8px',
                padding: '0.625rem', marginBottom: '0.5rem',
                background: '#f9fafb'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: idx === 0 ? '#dc2626' : '#6b7280' }}>
                    {idx === 0 ? 'Primary Contact' : `Contact ${idx + 1}`}
                  </span>
                  <button type="button" onClick={() => removeContact(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px' }}>
                    <Trash2 size={12} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.625rem' }}>
                  {/* Contact Photo */}
                  <div style={{ flexShrink: 0, position: 'relative' }}>
                    {(() => {
                      const rawPhoto = contact.photo_url || (contact.email && teamUsers && teamUsers.find(t => t.email === contact.email)?.photo_url) || '';
                      const resolvedPhoto = rawPhoto && !rawPhoto.startsWith('http') ? (contactPhotoCache[rawPhoto] || '') : rawPhoto;
                      return <div
                      style={{ width: 48, height: 48, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: 'pointer', border: '2px solid #d1d5db' }}
                      onClick={() => { setPhotoPopover(photoPopover === idx ? null : idx); setPhotoUrlInput('') }}
                    >
                      {resolvedPhoto ? (
                        <img src={resolvedPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.target.style.display = 'none' }} />
                      ) : null}
                      {!resolvedPhoto && <Users size={20} style={{ color: '#9ca3af' }} />}
                    </div>})()}
                    {photoPopover === idx && (
                      <>
                        <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setPhotoPopover(null)} />
                        <div style={{
                          position: 'absolute', top: 52, left: 0, zIndex: 50,
                          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '0.375rem',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: 140, whiteSpace: 'nowrap'
                        }}>
                          <button onClick={() => {
                            setPhotoPopover(null)
                            const input = document.createElement('input')
                            input.type = 'file'
                            input.accept = 'image/*'
                            input.onchange = async (ev) => {
                              const file = ev.target.files[0]
                              if (!file || !clientId) return
                              const ext = file.name.split('.').pop().toLowerCase()
                              const contentTypeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
                              const ct = contentTypeMap[ext]
                              if (!ct) { alert('Supported: PNG, JPG, GIF, WebP, SVG'); return }
                              if (file.size > 2 * 1024 * 1024) { alert('File must be under 2MB'); return }
                              try {
                                const res = await fetch(`${API_BASE}/upload/branding`, {
                                  method: 'POST', headers: getAuthHeaders(),
                                  body: JSON.stringify({ client_id: clientId, file_type: 'contact_photo', contact_index: idx, content_type: ct, file_extension: ext })
                                })
                                if (!res.ok) throw new Error('Failed to get upload URL')
                                const { upload_url, view_url, s3_key } = await res.json()
                                const s3Res = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': ct }, body: file })
                                if (!s3Res.ok) throw new Error('Upload failed')
                                const key = s3_key || view_url
                                const updatedContacts = formContacts.map((c, i) => i === idx ? { ...c, photo_url: key } : c)
                                updateContact(idx, 'photo_url', key)
                                if (s3_key && view_url) setContactPhotoCache(prev => ({ ...prev, [s3_key]: view_url }))
                                setTimeout(() => autoSave(null, updatedContacts), 0)
                              } catch (err) { console.error('Photo upload failed:', err); alert('Photo upload failed') }
                            }
                            input.click()
                          }} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%', padding: '0.35rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#333', borderRadius: 4 }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                            <Upload size={13} /> Upload photo
                          </button>
                          {photoUrlInput !== null && photoUrlInput !== '' ? (
                            <div style={{ display: 'flex', gap: '0.25rem', padding: '0.25rem 0.5rem' }}>
                              <input type="url" value={photoUrlInput === ' ' ? '' : photoUrlInput} onChange={e => setPhotoUrlInput(e.target.value || ' ')} autoFocus
                                placeholder="https://..." style={{ flex: 1, padding: '0.25rem 0.375rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '0.7rem', outline: 'none', width: 120 }} />
                              <button onClick={() => { if (photoUrlInput.trim()) { const val = photoUrlInput.trim(); const updatedContacts = formContacts.map((c, i) => i === idx ? { ...c, photo_url: val } : c); updateContact(idx, 'photo_url', val); setTimeout(() => autoSave(null, updatedContacts), 0) } setPhotoPopover(null) }}
                                style={{ padding: '0.25rem 0.5rem', background: '#0F969C', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer', fontWeight: 600 }}>Save</button>
                            </div>
                          ) : (
                            <button onClick={() => setPhotoUrlInput(' ')} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%', padding: '0.35rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#333', borderRadius: 4 }}
                              onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                              <Link size={13} /> Paste URL
                            </button>
                          )}
                          {contact.photo_url && (
                            <button onClick={() => { const updatedContacts = formContacts.map((c, i) => i === idx ? { ...c, photo_url: '' } : c); updateContact(idx, 'photo_url', ''); setTimeout(() => autoSave(null, updatedContacts), 0); setPhotoPopover(null) }}
                              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%', padding: '0.35rem 0.5rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#dc2626', borderRadius: 4 }}
                              onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                              <Trash2 size={13} /> Remove photo
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Contact Fields */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
                    <input type="text" value={contact.firstName || ''} onChange={(e) => updateContact(idx, 'firstName', e.target.value)} onBlur={autoSave}
                      placeholder="First Name" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                    <input type="text" value={contact.lastName || ''} onChange={(e) => updateContact(idx, 'lastName', e.target.value)} onBlur={autoSave}
                      placeholder="Last Name" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                  </div>
                  {formData.name && (
                    <div style={{ padding: '0.375rem 0.5rem', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '5px', fontSize: '0.75rem', color: '#6b7280' }}>
                      {formData.name}
                    </div>
                  )}
                  <input type="text" value={contact.title} onChange={(e) => updateContact(idx, 'title', e.target.value)} onBlur={autoSave}
                    placeholder="Title" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
                    <input type="email" value={contact.email} onChange={(e) => updateContact(idx, 'email', e.target.value)} onBlur={autoSave}
                      placeholder="Email" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <select value={splitPhone(contact.phone).countryCode} aria-label="Country code" onChange={(e) => { const val = joinPhone(e.target.value, splitPhone(contact.phone).number); const updatedContacts = formContacts.map((c, i) => i === idx ? { ...c, phone: val } : c); updateContact(idx, 'phone', val); setTimeout(() => autoSave(null, updatedContacts), 0) }}
                        style={{ width: '72px', flexShrink: 0, padding: '0.375rem 0.15rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }}>
                        {COUNTRY_CODES.map(cc => <option key={cc.code} value={cc.code}>{cc.code}</option>)}
                      </select>
                      <input type="tel" value={splitPhone(contact.phone).number} onChange={(e) => updateContact(idx, 'phone', joinPhone(splitPhone(contact.phone).countryCode, e.target.value))} onBlur={autoSave}
                        placeholder="Phone" style={{ flex: 1, padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                    </div>
                  </div>
                  <input type="url" value={contact.linkedin || ''} onChange={(e) => updateContact(idx, 'linkedin', e.target.value)} onBlur={autoSave}
                    placeholder="LinkedIn URL" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                  </div>
                </div>
              </div>
            ))}

            {formContacts.length > 1 && (
              <button
                type="button"
                onClick={() => setContactsExpanded(prev => !prev)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                  padding: '0.25rem 0', fontSize: '0.7rem', fontWeight: 600,
                  color: '#dc2626'
                }}
              >
                {contactsExpanded ? (
                  <>
                    <ChevronUp size={13} />
                    Hide {formContacts.length - 1} more contact{formContacts.length - 1 > 1 ? 's' : ''}
                  </>
                ) : (
                  <>
                    <ChevronDown size={13} />
                    View {formContacts.length - 1} more contact{formContacts.length - 1 > 1 ? 's' : ''}
                  </>
                )}
              </button>
            )}
          </div>

          {/* Divider */}
          <div style={{ height: '1px', background: '#e5e7eb' }} />

          {/* Addresses Section */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Addresses
              </label>
              <button
                type="button"
                onClick={addAddress}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                  padding: '0.2rem 0.5rem', fontSize: '0.7rem', fontWeight: 600,
                  background: 'rgba(220, 38, 38, 0.08)', color: '#dc2626',
                  border: '1px solid rgba(220, 38, 38, 0.25)', borderRadius: '4px', cursor: 'pointer'
                }}
              >
                <Plus size={12} /> Add
              </button>
            </div>

            {formAddresses.length === 0 && (
              <div style={{
                border: '1px dashed #d1d5db', borderRadius: '6px',
                padding: '0.75rem', textAlign: 'center', color: '#9ca3af',
                fontSize: '0.75rem'
              }}>
                No addresses yet
              </div>
            )}

            {formAddresses.map((addr, idx) => (idx > 0 && !addressesExpanded) ? null : (
              <div key={idx} style={{
                border: '1px solid #e5e7eb', borderRadius: '8px',
                padding: '0.625rem', marginBottom: '0.5rem',
                background: '#f9fafb'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: idx === 0 ? '#dc2626' : '#6b7280' }}>
                    {idx === 0 ? 'Primary Address' : `Address ${idx + 1}`}
                  </span>
                  <button type="button" onClick={() => removeAddress(idx)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: '2px' }}>
                    <Trash2 size={12} />
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <input type="text" value={addr.label || ''} onChange={(e) => updateAddress(idx, 'label', e.target.value)} onBlur={autoSave}
                    placeholder="Label (e.g., Headquarters, Warehouse)" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                  <input type="text" value={addr.address1 || ''} onChange={(e) => updateAddress(idx, 'address1', e.target.value)} onBlur={autoSave}
                    placeholder="Address Line 1" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                  <input type="text" value={addr.address2 || ''} onChange={(e) => updateAddress(idx, 'address2', e.target.value)} onBlur={autoSave}
                    placeholder="Address Line 2" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.375rem' }}>
                    <input type="text" value={addr.city || ''} onChange={(e) => updateAddress(idx, 'city', e.target.value)} onBlur={autoSave}
                      placeholder="City" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                    <input type="text" value={addr.state || ''} onChange={(e) => updateAddress(idx, 'state', e.target.value)} onBlur={autoSave}
                      placeholder="State / Province" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                    <input type="text" value={addr.postalCode || ''} onChange={(e) => updateAddress(idx, 'postalCode', e.target.value)} onBlur={autoSave}
                      placeholder="Postal Code" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                    <input type="text" value={addr.country || ''} onChange={(e) => updateAddress(idx, 'country', e.target.value)} onBlur={autoSave}
                      placeholder="Country" style={{ width: '100%', padding: '0.375rem 0.5rem', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '5px', fontSize: '0.75rem', color: '#111827', fontFamily: 'inherit', outline: 'none' }} />
                  </div>
                </div>
              </div>
            ))}

            {formAddresses.length > 1 && (
              <button
                type="button"
                onClick={() => setAddressesExpanded(prev => !prev)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.25rem',
                  padding: '0.25rem 0', fontSize: '0.7rem', fontWeight: 600,
                  color: '#dc2626'
                }}
              >
                {addressesExpanded ? (
                  <>
                    <ChevronUp size={13} />
                    Hide {formAddresses.length - 1} more address{formAddresses.length - 1 > 1 ? 'es' : ''}
                  </>
                ) : (
                  <>
                    <ChevronDown size={13} />
                    View {formAddresses.length - 1} more address{formAddresses.length - 1 > 1 ? 'es' : ''}
                  </>
                )}
              </button>
            )}
          </div>

          {/* Autosave Indicator */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '0.375rem', padding: '0.375rem 0', minHeight: '1.5rem',
            transition: 'opacity 0.3s',
            opacity: saving || savedIndicator ? 1 : 0
          }}>
            {saving ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', color: '#6b7280' }} />
                <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>Saving...</span>
              </>
            ) : savedIndicator ? (
              <>
                <CheckCircle size={13} style={{ color: '#22c55e' }} />
                <span style={{ fontSize: '0.75rem', color: '#22c55e' }}>Saved</span>
              </>
            ) : null}
          </div>

        </div>

        {/* RIGHT COLUMN — Workflow Cards */}
        <div className="workspace-col-right" style={{ flex: '1 1 0', minWidth: '300px', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>


          {/* Card 2: Domain Expertise */}
          <div style={{
            background: '#1a1a2e',
            borderRadius: '10px',
            padding: '0.625rem 0.75rem',
            border: step1Complete ? '2px solid #dc2626' : '2px solid transparent',
            transition: 'all 0.3s',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: step1Complete ? '#dc2626' : 'rgba(220, 38, 38, 0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid rgba(220, 38, 38, 0.3)', transition: 'all 0.3s'
              }}>
                {step1Complete ? (
                  <CheckCircle2 size={16} style={{ color: 'white' }} />
                ) : (
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#dc2626' }}>1</span>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'white', marginBottom: '0.1rem', letterSpacing: '-0.01em' }}>
                  DOMAIN EXPERTISE
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                  The Filter
                </p>
                <p style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.7)', lineHeight: 1.4, marginBottom: '0.35rem' }}>
                  Tell us about your business. YOU are the filter.
                </p>

                {step1Complete ? (
                  <div style={{
                    padding: '0.625rem',
                    background: 'rgba(220, 38, 38, 0.1)',
                    border: '1px solid rgba(220, 38, 38, 0.3)',
                    borderRadius: '8px'
                  }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'white' }}>{companyData.name}</div>
                    {companyData.industry && (
                      <div style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)', marginTop: '0.15rem' }}>{companyData.industry}</div>
                    )}
                  </div>
                ) : (
                  <p style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.45)', fontStyle: 'italic' }}>
                    Fill in partner information and save →
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Card 2: Raw Data */}
          <div style={{
            background: '#1a1a2e',
            borderRadius: '10px',
            padding: '0.625rem 0.75rem',
            border: step2Complete ? '2px solid #dc2626' : '2px solid transparent',
            transition: 'all 0.3s',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: step2Complete ? '#dc2626' : 'rgba(220, 38, 38, 0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '2px solid rgba(220, 38, 38, 0.3)', transition: 'all 0.3s'
              }}>
                {step2Complete ? (
                  <CheckCircle2 size={16} style={{ color: 'white' }} />
                ) : (
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#dc2626' }}>2</span>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'white', marginBottom: '0.1rem', letterSpacing: '-0.01em' }}>
                  YOUR DATA
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                  The Noise
                </p>
                <p style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.7)', lineHeight: 1.4, marginBottom: '0.5rem' }}>
                  Upload documents, connect your data libraries.
                </p>

                {sourceCount > 0 ? (
                  <div style={{
                    padding: '0.875rem',
                    background: 'rgba(220, 38, 38, 0.1)',
                    border: '1px solid rgba(220, 38, 38, 0.3)',
                    borderRadius: '8px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <FolderOpen size={18} style={{ color: '#dc2626' }} />
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'white' }}>
                           Your data librar{sourceCount !== 1 ? 'ies' : 'y'} {sourceCount}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                        {activeCount} active
                      </span>
                    </div>
                    <div style={{display:"flex",justifyContent:"center",gap:"0.375rem"}}>
                    <button
                      onClick={() => onNavigate('sources')}
                      style={{
                        padding: '0.5rem',
                        background: 'rgba(220, 38, 38, 0.15)',
                        border: '1px solid rgba(220, 38, 38, 0.3)',
                        borderRadius: '6px', color: '#dc2626',
                        fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem'
                      }}
                    >
                      <FolderOpen size={14} />
                      Manage Your Data
                    </button>
                    </div>
                  </div>
                ) : (
                  <div style={{display:"flex",justifyContent:"center",gap:"0.375rem"}}><button
                    onClick={() => onNavigate('sources')}
                    className="action-btn red"
                    style={{ justifyContent: 'center', padding: '0.75rem', fontSize: '0.9rem' }}
                  >
                    <Upload size={18} />
                    Add Your Data
                  </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Card 3: Intellagentic Growth */}
          <div style={{
            background: allStepsComplete ? '#1a1a2e' : '#2a2a3e',
            borderRadius: '10px',
            padding: '0.625rem 0.75rem',
            border: allStepsComplete ? '2px solid transparent' : '2px solid rgba(100, 100, 100, 0.3)',
            transition: 'all 0.3s',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: allStepsComplete ? 'rgba(220, 38, 38, 0.2)' : 'rgba(150, 150, 150, 0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `2px solid ${allStepsComplete ? 'rgba(220, 38, 38, 0.3)' : 'rgba(150, 150, 150, 0.4)'}`,
                transition: 'all 0.3s'
              }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: allStepsComplete ? '#dc2626' : '#999' }}>3</span>
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{
                  fontSize: '0.9375rem', fontWeight: 700,
                  color: allStepsComplete ? 'white' : 'rgba(255, 255, 255, 0.7)',
                  marginBottom: '0.1rem', letterSpacing: '-0.01em'
                }}>
                  INTELLAGENTIC GROWTH
                </h3>
                <p style={{
                  fontSize: '0.75rem',
                  color: allStepsComplete ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.55)',
                  fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem'
                }}>
                  The Output
                </p>
                <p style={{
                  fontSize: '0.8rem',
                  color: allStepsComplete ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.65)',
                  lineHeight: 1.4, marginBottom: '0.5rem'
                }}>
                  MBA-level analysis. Problems identified. Schema proposed. Action plan delivered.
                </p>

                {allStepsComplete ? (
                    <div style={{display:"flex",justifyContent:"center",gap:"0.375rem"}}>
                      {/*<button className={"action-btn btn-primary"}
                      onClick={() => onNavigate('skills')}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                        padding: '0.45rem', fontSize: '0.75rem', fontWeight: 600,
                        color: 'white', border: 'none', borderRadius: '7px',
                        cursor: 'pointer', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.25)', transition: 'all 0.2s'
                      }}
                    >
                      <Database size={14} />
                      Skills
                    </button>*/}
                    <button className={"action-btn btn-primary"}
                      onClick={onComplete}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                        padding: '0.55rem', fontSize: '0.8rem', fontWeight: 600,
                        color: 'white', border: 'none', borderRadius: '7px',
                        cursor: 'pointer', boxShadow: '0 4px 12px rgba(34, 197, 94, 0.25)', transition: 'all 0.2s'
                      }}
                    >
                      <Sparkles size={15} />
                      Enrich
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)', fontStyle: 'italic', textAlign: 'center' }}>
                    Complete steps 1, 2 & 3 →
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Founder Quotes — admin only */}
          {isAdmin && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
            marginTop: '0.25rem'
          }}>
            {/* Alan's Quote */}
            <div style={{ padding: '0.25rem 0' }}>
              <div style={{
                fontSize: '3rem', lineHeight: 0.8, color: '#dc2626',
                fontFamily: 'Georgia, serif', marginBottom: '0.25rem', opacity: 0.8
              }}>"</div>
              <p style={{
                fontSize: '0.85rem', fontStyle: 'italic', color: 'var(--text-primary)',
                lineHeight: 1.6, marginBottom: '0.5rem'
              }}>
                I wasn't leading. I was typing at 6:00 AM. I became my own admin clerk.
              </p>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
                — Alan Moore, Co-Founder & CEO
              </p>
            </div>

            {/* Ken's Quote */}
            <div style={{ padding: '0.25rem 0' }}>
              <div style={{
                fontSize: '3rem', lineHeight: 0.8, color: '#dc2626',
                fontFamily: 'Georgia, serif', marginBottom: '0.25rem', opacity: 0.8
              }}>"</div>
              <p style={{
                fontSize: '0.85rem', fontStyle: 'italic', color: 'var(--text-primary)',
                lineHeight: 1.6, marginBottom: '0.5rem'
              }}>
                We're business operators first, not technologists. We built this because we needed it.
              </p>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: 0 }}>
                — Ken Scott, Co-Founder & President
              </p>
            </div>
          </div>
          )}

        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div style={{
          background: 'rgba(220, 38, 38, 0.1)',
          border: '1px solid rgba(220, 38, 38, 0.3)',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertCircle size={20} style={{ color: '#dc2626', flexShrink: 0 }} />
          <p style={{ fontSize: '0.875rem', color: '#dc2626', margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      {/* Engagement Modal */}
      {showEngagementModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => { setShowEngagementModal(false); setEditEngagement(null) }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: 'var(--bg-card, #fff)', borderRadius: 16, padding: '1.5rem', width: '90%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>{editEngagement ? 'Edit Engagement' : 'New Engagement'}</h3>
              <button onClick={() => { setShowEngagementModal(false); setEditEngagement(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <EngagementForm
              initial={editEngagement}
              saving={engagementSaving}
              onSave={async (data) => {
                setEngagementSaving(true)
                try {
                  if (editEngagement) {
                    await fetch(`${API_BASE}/engagements`, { method: 'PUT', headers: getAuthHeaders(), body: JSON.stringify({ engagement_id: editEngagement.id, ...data }) })
                  } else {
                    await fetch(`${API_BASE}/engagements`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ client_id: clientId, ...data }) })
                  }
                  // Refresh engagements list
                  const res = await fetch(`${API_BASE}/engagements?client_id=${clientId}`, { headers: getAuthHeaders() })
                  if (res.ok) { const d = await res.json(); setEngagements(d.engagements || []) }
                  setShowEngagementModal(false)
                  setEditEngagement(null)
                } catch (err) { alert('Failed to save engagement: ' + err.message) }
                setEngagementSaving(false)
              }}
              onDelete={editEngagement ? async () => {
                if (!window.confirm(`Delete engagement "${editEngagement.name}"?`)) return
                try {
                  await fetch(`${API_BASE}/engagements?engagement_id=${editEngagement.id}`, { method: 'DELETE', headers: getAuthHeaders() })
                  setEngagements(prev => prev.filter(e => e.id !== editEngagement.id))
                  if (activeEngagement?.id === editEngagement.id) { setActiveEngagement(null); sessionStorage.removeItem('xo-engagement-' + clientId) }
                  setShowEngagementModal(false)
                  setEditEngagement(null)
                } catch (err) { alert('Failed to delete: ' + err.message) }
              } : null}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Engagement Form (used inside modal) ──
function EngagementForm({ initial, saving, onSave, onDelete }) {
  const [name, setName] = useState(initial?.name || '')
  const [focusArea, setFocusArea] = useState(initial?.focus_area || '')
  const [status, setStatus] = useState(initial?.status || 'active')

  const inputStyle = { width: '100%', padding: '0.5rem 0.625rem', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: '0.85rem', fontFamily: 'inherit', color: 'var(--text-primary)', background: 'var(--bg-input, #fff)', outline: 'none' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-primary)' }}>Name *</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Facilities Management, Phase 2 Rollout" style={inputStyle} />
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-primary)' }}>Focus Area</label>
        <textarea value={focusArea} onChange={e => setFocusArea(e.target.value)} placeholder="What should the analysis focus on? e.g., Focus on facilities management operations, maintenance scheduling, and compliance reporting" rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        <p style={{ fontSize: '0.65rem', color: '#9ca3af', marginTop: '0.2rem' }}>This directive is injected into the enrichment prompt to scope the analysis.</p>
      </div>
      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.3rem', color: 'var(--text-primary)' }}>Status</label>
        <select value={status} aria-label="Engagement status" onChange={e => setStatus(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
          <option value="active">Active</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
          <option value="paused">Paused</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
        {onDelete && (
          <button onClick={onDelete} style={{ padding: '0.5rem 0.75rem', background: 'none', border: '1px solid #ef4444', color: '#ef4444', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', marginRight: 'auto' }}>
            <Trash2 size={13} style={{ marginRight: '0.25rem', verticalAlign: 'middle' }} /> Delete
          </button>
        )}
        <button
          onClick={() => { if (name.trim()) onSave({ name: name.trim(), focus_area: focusArea.trim(), status }) }}
          disabled={saving || !name.trim()}
          style={{ padding: '0.5rem 1rem', background: name.trim() ? '#dc2626' : '#e5e7eb', color: name.trim() ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: name.trim() && !saving ? 'pointer' : 'not-allowed' }}>
          {saving ? 'Saving...' : initial ? 'Update' : 'Create Engagement'}
        </button>
      </div>
    </div>
  )
}

// ============================================================
// SOURCES SCREEN — NotebookLM-style Source Library
// ============================================================
function ActiveEngagementBanner({ activeEngagement, onNavigate }) {
  if (!activeEngagement) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', marginBottom: '0.75rem', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8 }}>
      <Package size={14} style={{ color: '#dc2626', flexShrink: 0 }} />
      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Engagement:</span>
      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>{activeEngagement.name}</span>
      {activeEngagement.focus_area && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.25rem' }}>— {activeEngagement.focus_area.length > 60 ? activeEngagement.focus_area.substring(0, 60) + '...' : activeEngagement.focus_area}</span>}
      <button onClick={() => onNavigate('upload')} style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', flexShrink: 0 }}>Change</button>
    </div>
  )
}

function getFileIcon(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase()
  const map = {
    csv: FileSpreadsheet, xls: FileSpreadsheet, xlsx: FileSpreadsheet,
    pdf: FileText, doc: FileText, docx: FileText, txt: FileText,
    mp3: Music, wav: Music, m4a: Music, aac: Music,
    png: Image, jpg: Image, jpeg: Image, gif: Image,
    json: FileType, xml: FileType,
    ppt: File, pptx: File, zip: File
  }
  return map[ext] || File
}

function formatFileSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateTime(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric',hour:'numeric',minute:'numeric',hour12:true })
}

function SourcesScreen({ clientId, companyData, onNavigate,preferredModel, isAdmin }) {
  const [uploads, setUploads] = useState([])
  const [loading, setLoading] = useState(true)
  const [isDragging, setIsDragging] = useState(false)
  const [pendingFiles, setPendingFiles] = useState([]) // { file, progress }
  const [openMenuId, setOpenMenuId] = useState(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState(null)
  const [replacingId, setReplacingId] = useState(null)
  const [currentClient,setCurrentClient] = useState(null)

  const [consentAgreed, setConsentAgreed] = useState(isAdmin || false)
  const [consentAgreedAt, setConsentAgreedAt] = useState('')
  const [existingApps, setExistingApps] = useState('')

  // Text input source state
  const [textSourceLabel, setTextSourceLabel] = useState('')
  const [textSourceContent, setTextSourceContent] = useState('')
  const [textSourceSaving, setTextSourceSaving] = useState(false)
  const [textSourceStatus, setTextSourceStatus] = useState(null) // 'saved' | 'error' | null
  const [textSourceError, setTextSourceError] = useState('')

  // Google Drive state
  const [gdriveConnected, setGdriveConnected] = useState(false)
  const [gdriveLoading, setGdriveLoading] = useState(false)
  const [showGdrivePicker, setShowGdrivePicker] = useState(false)
  const [gdriveFiles, setGdriveFiles] = useState([])
  const [selectedGdriveFiles, setSelectedGdriveFiles] = useState([])
  const [gdriveImporting, setGdriveImporting] = useState(false)
  const [currentGdriveFolder, setCurrentGdriveFolder] = useState('root')
  const [gdriveFolderStack, setGdriveFolderStack] = useState([])

  useEffect(() => {
    if (clientId) {
      fetchClient(clientId);
      fetchUploads();
    }
    else setLoading(false)
  }, [clientId])

  // Close kebab menu on outside click
  useEffect(() => {
    const handler = () => setOpenMenuId(null)
    if (openMenuId) document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [openMenuId])

  const fetchUploads = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/uploads?client_id=${clientId}`, { headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        setUploads(data.uploads || [])
      }
    } catch (err) {
      console.error('Failed to fetch uploads:', err)
    } finally {
      setLoading(false)
    }
  }

  // === Upload Handlers ===
  const handleDragOver = (e) => { e.preventDefault(); if (consentAgreed) setIsDragging(true) }
  const handleDragLeave = (e) => { e.preventDefault(); setIsDragging(false) }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (!consentAgreed) {
      alert('Please accept the data processing consent before uploading')
      return
    }
    const droppedFiles = Array.from(e.dataTransfer.files)
    uploadFiles(droppedFiles)
  }

  const handleFileSelect = (e) => {
    if (!consentAgreed) return
    const selectedFiles = Array.from(e.target.files)
    uploadFiles(selectedFiles)
    e.target.value = '' // reset so same file can be re-selected
  }

  const uploadFiles = async (fileList) => {
    if (!clientId) return

    const validExtensions = ['csv', 'txt', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'json', 'xml', 'zip', 'mp3', 'wav', 'm4a', 'aac', 'png', 'jpg', 'jpeg', 'webp']
    const filtered = fileList.filter(file => {
      const ext = file.name.split('.').pop().toLowerCase()
      return validExtensions.includes(ext)
    })
    if (filtered.length === 0) return

    // Add to pending
    const pending = filtered.map(f => ({ file: f, progress: 0 }))
    setPendingFiles(prev => [...prev, ...pending])

    try {
      // Get presigned URLs
      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          client_id: clientId,
          files: filtered.map(f => ({ name: f.name, type: f.type, size: f.size }))
        })
      })
      if (!res.ok) throw new Error('Failed to get upload URLs')
      const { upload_urls, upload_ids } = await res.json()

      // Upload each file
      for (let i = 0; i < filtered.length; i++) {
        const file = filtered[i]
        const s3Res = await fetch(upload_urls[i], {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type }
        })
        if (!s3Res.ok) {
          if (upload_ids && upload_ids[i]) {
            await fetch(`${API_BASE}/uploads/${upload_ids[i]}`, { method: 'DELETE', headers: getAuthHeaders() }).catch(() => {})
          }
          throw new Error(`Upload failed for ${file.name} (${s3Res.status})`)
        }
        setPendingFiles(prev => prev.map(p =>
          p.file.name === file.name ? { ...p, progress: 100 } : p
        ))
      }

      // Refresh list and clear pending
      await fetchUploads()
      setPendingFiles(prev => prev.filter(p => p.progress < 100))
    } catch (err) {
      console.error('Upload error:', err)
      alert('Upload failed: ' + (err.message || 'Unknown error'))
      setPendingFiles([])
    }
  }

  // Upload text as a .txt file source
  const addTextSource = async () => {
    if (!clientId || !textSourceContent.trim()) return
    setTextSourceSaving(true)
    setTextSourceStatus(null)
    setTextSourceError('')
    try {
      const label = (textSourceLabel.trim() || 'Text Note').replace(/[^a-zA-Z0-9 _-]/g, '') || 'Text_Note'
      const fileName = `${label.replace(/\s+/g, '_')}_${Date.now()}.txt`
      const blob = new Blob([textSourceContent], { type: 'text/plain' })
      const file = new globalThis.File([blob], fileName, { type: 'text/plain' })

      // Step 1: Get presigned URL + create DB record
      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          client_id: clientId,
          files: [{ name: file.name, type: file.type, size: file.size }]
        })
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Upload request failed (${res.status})`)
      }
      const data = await res.json()
      const uploadUrl = (data.upload_urls || [])[0]
      if (!uploadUrl) throw new Error('No upload URL returned')

      // Step 2: Upload file content to S3
      const s3Res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': 'text/plain' }
      })
      if (!s3Res.ok) throw new Error(`S3 upload failed (${s3Res.status})`)

      // Step 3: Refresh list and show success
      await fetchUploads()
      setTextSourceLabel('')
      setTextSourceContent('')
      setTextSourceStatus('saved')
      setTimeout(() => setTextSourceStatus(null), 3000)
    } catch (err) {
      console.error('Text source upload error:', err)
      setTextSourceStatus('error')
      setTextSourceError(err.message || 'Failed to save text source')
    }
    setTextSourceSaving(false)
  }

  // === CRUD Handlers ===
  const toggleUpload = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/uploads/${id}/toggle`, {
        method: 'PUT',
        headers: getAuthHeaders()
      })
      if (res.ok) {
        const data = await res.json()
        setUploads(prev => prev.map(u => u.id === id ? { ...u, status: data.status } : u))
      }
    } catch (err) {
      console.error('Toggle error:', err)
    }
  }

  const deleteUpload = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/uploads/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (res.ok) {
        setUploads(prev => prev.filter(u => u.id !== id))
        setDeleteConfirmId(null)
      }
    } catch (err) {
      console.error('Delete error:', err)
    }
  }

  const handleReplace = async (parentId, file) => {
    try {
      const res = await fetch(`${API_BASE}/uploads/${parentId}/replace`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: file.name, type: file.type, size: file.size })
      })
      if (!res.ok) throw new Error('Failed to replace')
      const data = await res.json()

      // Upload new file
      await fetch(data.upload_url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type }
      })

      setReplacingId(null)
      await fetchUploads()
    } catch (err) {
      console.error('Replace error:', err)
    }
  }

  // === Google Drive Functions ===
  const connectGoogleDrive = async () => {
    setGdriveLoading(true)
    try {
      const res = await fetch(`${API_BASE}/gdrive/auth-url`, { headers: getAuthHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to get auth URL')
      const popup = window.open(data.auth_url, 'google-drive-auth', 'width=500,height=600,scrollbars=yes')
      const pollTimer = setInterval(async () => {
        try {
          if (!popup || popup.closed) { clearInterval(pollTimer); setGdriveLoading(false); return }
          const popupUrl = popup.location.href
          if (popupUrl.startsWith(window.location.origin)) {
            clearInterval(pollTimer)
            const url = new URL(popupUrl)
            const code = url.searchParams.get('code')
            popup.close()
            if (code) {
              const cbRes = await fetch(`${API_BASE}/gdrive/callback`, {
                method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ code })
              })
              if (cbRes.ok) setGdriveConnected(true)
            }
            setGdriveLoading(false)
          }
        } catch { /* cross-origin while on Google domain */ }
      }, 500)
    } catch (err) {
      console.error('Google Drive connect error:', err)
      setGdriveLoading(false)
    }
  }

  const fetchGdriveFiles = async (folderId = 'root') => {
    try {
      const res = await fetch(`${API_BASE}/gdrive/files?folder_id=${folderId}`, { headers: getAuthHeaders() })
      const data = await res.json()
      if (res.ok) { setGdriveFiles(data.files || []); setCurrentGdriveFolder(folderId) }
    } catch (err) { console.error('Fetch Drive files error:', err) }
  }

  const openGdrivePicker = async () => {
    setShowGdrivePicker(true)
    setSelectedGdriveFiles([])
    setGdriveFolderStack([])
    setCurrentGdriveFolder('root')
    await fetchGdriveFiles('root')
  }

  const navigateToGdriveFolder = async (folderId, folderName) => {
    setGdriveFolderStack(prev => [...prev, { id: currentGdriveFolder, name: folderName }])
    await fetchGdriveFiles(folderId)
  }

  const navigateGdriveBack = async () => {
    const stack = [...gdriveFolderStack]
    const parent = stack.pop()
    setGdriveFolderStack(stack)
    await fetchGdriveFiles(parent ? parent.id : 'root')
  }

  const toggleGdriveFileSelection = (file) => {
    setSelectedGdriveFiles(prev => {
      const exists = prev.find(f => f.id === file.id)
      return exists ? prev.filter(f => f.id !== file.id) : [...prev, file]
    })
  }

  const importGdriveFiles = async () => {
    if (selectedGdriveFiles.length === 0) return
    setGdriveImporting(true)
    try {
      const res = await fetch(`${API_BASE}/gdrive/import`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ file_ids: selectedGdriveFiles.map(f => f.id), client_id: clientId })
      })
      if (res.ok) await fetchUploads()
      setShowGdrivePicker(false)
      setSelectedGdriveFiles([])
    } catch (err) { console.error('Import error:', err) }
    setGdriveImporting(false)
  }

  // === Computed ===
  const activeUploads = uploads.filter(u => u.status === 'active')
  const totalSize = uploads.reduce((sum, u) => sum + (u.file_size || 0), 0)
  //console.log(currentClient);

  const fetchClient = async (clientId)=>{
    if(clientId) {
      try {
        const res = await fetch(`${API_BASE}/clients?client_id=${clientId}`, {headers: getAuthHeaders()})
        if (res.ok) {
          const data = await res.json();
          setCurrentClient(data);
          setConsentAgreed(isAdmin || data.ndaSigned);
          setConsentAgreedAt(data.ndaSignedAt);
          setExistingApps(data.existingApps);
          //console.log(data);
        }
      } catch (err) {
        console.error('Failed to fetch client:', err)
      }
    }
  }
  const addExistingApps = async ()=>{
    if(clientId){
      // Update existing client
      const response = await fetch(`${API_BASE}/clients`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          client_id: clientId,
          company_name:currentClient.company_name,
          website: currentClient.website,
          contacts: currentClient.contacts || [],
          addresses: currentClient.addresses || [],
          industry: currentClient.industry,
          description: currentClient.description,
          painPoint: currentClient.painPoint,
          futurePlans: currentClient.futurePlans || '',
          painPoints: currentClient.painPoints || [],
          account_id: currentClient.account_id,
          intellagentic_lead: currentClient.intellagentic_lead,
          ndaSigned:currentClient.ndaSigned,
          existingApps: existingApps
        })
      })
      if (response.ok) {
        //console.log('Client updated:', clientId)
        fetchClient(clientId);
      }
    }
  }

  const handleConsent = async ()=>{
    if(clientId){
      // Update existing client
      const response = await fetch(`${API_BASE}/clients`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          client_id: clientId,
          company_name:currentClient.company_name,
          website: currentClient.website,
          contacts: currentClient.contacts || [],
          addresses: currentClient.addresses || [],
          industry: currentClient.industry,
          description: currentClient.description,
          painPoint: currentClient.painPoint,
          futurePlans: currentClient.futurePlans || '',
          painPoints: currentClient.painPoints || [],
          account_id: currentClient.account_id,
          intellagentic_lead: currentClient.intellagentic_lead,
          existingApps:currentClient.existingApps,
          ndaSigned: true
        })
      })
      if (response.ok) {
        //console.log('Client updated:', clientId)
        fetchClient(clientId);
      }
    }
  }

  // === No clientId state ===
  if (!clientId) {
    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <FolderOpen size={20} className="icon-red" />
            <h2>Your Data Library</h2>
          </div>
        </div>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <FolderOpen size={64} style={{ color: '#dc2626', opacity: 0.5, margin: '0 auto 1.5rem' }} />
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
            Complete Domain Expertise First
          </h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            Fill in your company information on the Welcome screen to create a project,<br />
            then come back here to upload and manage your data.
          </p>
          <button
            onClick={() => onNavigate('upload')}
            className="action-btn red"
            style={{ padding: '0.625rem 1.5rem', fontSize: '0.875rem' }}
          >
            <Home size={18} />
            Go to Welcome
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Panel 1: Source Library ── */}
      <div className="panel" style={{ overflow: 'visible' }}>
        <div className="panel-header">
          <div className="panel-header-left">
            <FileScan size={20} className="icon-red" />
            <h2>Consent</h2>
            <span style={{
              marginLeft: 'auto',
              fontSize: '0.7rem',
              fontWeight: 600,
              color: preferredModel.includes('opus') ? '#a855f7' : '#3b82f6',
              background: preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.1)' : 'rgba(59, 130, 246, 0.1)',
              padding: '3px 10px',
              borderRadius: '999px',
              border: `1px solid ${preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
            }}>
            Intellagentic Engine
          </span>
            <span style={{
              marginLeft: 'auto',
              fontSize: '0.7rem',
              fontWeight: 600,
              color: preferredModel.includes('opus') ? '#a855f7' : '#3b82f6',
              background: preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.1)' : 'rgba(59, 130, 246, 0.1)',
              padding: '3px 10px',
              borderRadius: '999px',
              border: `1px solid ${preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
            }}>
            {MODEL_LABELS[preferredModel] || preferredModel}
          </span>
          </div>
          {!consentAgreed && (<button
              onClick={handleConsent}
              style={{ background: 'var(--action-primary)', border: '2px solid var(--action-primary)',borderRadius:"8px", color: 'white', cursor: 'pointer', padding: '0.45rem' }}
              title="Data Processing Consent"
          >
            <FileScan size={16} /> {"I AGREE"}
          </button>)}
          {consentAgreed && (<div style={{color:"var(--text-primary)"}}>
            {consentAgreedAt ? "Consent Agreed: "+formatDateTime(consentAgreedAt) : isAdmin ? <span style={{ color: '#d97706', fontStyle: 'italic' }}>Admin Bypass — client consent pending</span> : "Consent Agreed: -"}
          </div>)}
        </div>
        <div style={{ padding: '1.25rem',color:"var(--text-muted)"}}>
          I agree to the use of my data by Intellagentic as part of the XO Capture analysis and solution recommendation process.
        </div>
      </div>

      {/* ── Panel 1: Source Library ── */}
      <div className="panel" style={{ overflow: 'visible' }}>
        <div className="panel-header">
          <div className="panel-header-left">
            <FolderOpen size={20} className="icon-red" />
            <h2>Your Data Library</h2>
            <span className="badge-count blue">{uploads.length}</span>
          </div>
          <button
            onClick={fetchUploads}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem' }}
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Summary Bar */}
        {uploads.length > 0 && (
          <div style={{
            padding: '0.5rem 1.25rem',
            background: 'var(--surface-secondary, rgba(255,255,255,0.03))',
            borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))',
            display: 'flex',
            gap: '1rem',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)'
          }}>
            <span><strong style={{ color: 'var(--text-primary)' }}>{activeUploads.length}</strong> active</span>
            <span><strong style={{ color: 'var(--text-primary)' }}>{uploads.length}</strong> total</span>
            <span><strong style={{ color: 'var(--text-primary)' }}>{formatFileSize(totalSize)}</strong></span>
          </div>
        )}

        <div style={{ padding: '1.25rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <Loader2 size={64} style={{ color: '#dc2626', opacity: 0.5, margin: '0 auto 1.5rem', animation: 'spin 1s linear infinite' }} />
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                Loading Your Data
              </h3>
            </div>
          ) : uploads.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              <FolderOpen size={64} style={{ color: '#dc2626', opacity: 0.5, margin: '0 auto 1.5rem' }} />
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
                No Data Yet
              </h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.6 }}>
                Your Data Library are the raw data that feeds your analysis — CSVs, PDFs, audio recordings,<br />
                spreadsheets. Drop files below or connect Google Drive.
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Drag & drop files in the <strong>Add Your Data</strong> area below to get started.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {uploads.map(upload => {
                const IconComp = getFileIcon(upload.filename)
                const isActive = upload.status === 'active'
                const isReplaced = upload.status === 'replaced'
                const isMenuOpen = openMenuId === upload.id
                const isDeleting = deleteConfirmId === upload.id

                if (isReplaced) return null // hide replaced versions from main list

                return (
                  <div
                    key={upload.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.75rem 0.875rem',
                      background: 'var(--surface-secondary, rgba(255,255,255,0.03))',
                      border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                      borderRadius: '10px',
                      opacity: isActive ? 1 : 0.5,
                      filter: isActive ? 'none' : 'grayscale(30%)',
                      transition: 'all 0.2s',
                      position: 'relative',
                      overflow: 'visible'
                    }}
                  >
                    {/* File Icon */}
                    <div style={{
                      width: 36, height: 36, borderRadius: '8px',
                      background: 'rgba(220, 38, 38, 0.1)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                    }}>
                      <IconComp size={18} style={{ color: '#dc2626' }} />
                    </div>

                    {/* File Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <span style={{
                          fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }}>
                          {upload.filename}
                        </span>
                        {upload.version > 1 && (
                          <span style={{
                            fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px',
                            borderRadius: '4px', background: 'rgba(59, 130, 246, 0.15)',
                            color: '#3b82f6'
                          }}>
                            v{upload.version}
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '0.625rem', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {/*<span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          padding: '1px 6px', borderRadius: '999px', fontSize: '0.6rem', fontWeight: 600,
                          background: upload.source === 'google_drive' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(220, 38, 38, 0.12)',
                          color: upload.source === 'google_drive' ? '#3b82f6' : '#dc2626'
                        }}>
                          {upload.source === 'google_drive' ? 'Google Drive' : 'Local'}
                        </span>*/}
                        <span>{formatFileSize(upload.file_size)}</span>
                        <span>{" Uploaded: "+formatDateTime(upload.uploaded_at)}</span>
                      </div>
                    </div>

                    {/* Toggle */}
                    <button
                      onClick={() => toggleUpload(upload.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem',
                        color: isActive ? '#22c55e' : 'var(--text-muted)', flexShrink: 0
                      }}
                      title={isActive ? 'Deactivate' : 'Activate'}
                    >
                      {isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    </button>

                    {/* Kebab Menu */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(isMenuOpen ? null : upload.id) }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem',
                          color: 'var(--text-muted)'
                        }}
                      >
                        <MoreVertical size={18} />
                      </button>

                      {isMenuOpen && (
                        <div style={{
                          position: 'absolute', right: 0, top: '100%', zIndex: 50,
                          background: '#ffffff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px', padding: '0.25rem 0', minWidth: '150px',
                          boxShadow: '0 4px 16px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.08)',
                          marginTop: '4px'
                        }}>
                          <button
                            onClick={async (e) => { e.stopPropagation(); setOpenMenuId(null); try { const res = await fetch(`${API_BASE}/uploads?action=view&client_id=${clientId}&s3_key=${encodeURIComponent(upload.s3_key)}`, { headers: getAuthHeaders() }); const data = await res.json(); if (data.url) window.open(data.url, '_blank'); else alert('Failed to get view URL'); } catch (err) { alert('Failed to get view URL') } }}
                            style={{
                              width: '100%', textAlign: 'left', padding: '0.5rem 0.875rem',
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: '#1a1a1a', fontSize: '0.8rem',
                              display: 'flex', alignItems: 'center', gap: '0.5rem'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <Eye size={14} /> View
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setReplacingId(upload.id); setOpenMenuId(null) }}
                            style={{
                              width: '100%', textAlign: 'left', padding: '0.5rem 0.875rem',
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: '#1a1a1a', fontSize: '0.8rem',
                              display: 'flex', alignItems: 'center', gap: '0.5rem'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <RefreshCw size={14} /> Replace
                          </button>
                          <div style={{ height: '1px', background: '#e5e7eb', margin: '0.25rem 0' }} />
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(upload.id); setOpenMenuId(null) }}
                            style={{
                              width: '100%', textAlign: 'left', padding: '0.5rem 0.875rem',
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: '#ef4444', fontSize: '0.8rem',
                              display: 'flex', alignItems: 'center', gap: '0.5rem'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Delete Confirmation Overlay */}
                    {isDeleting && (
                      <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', zIndex: 100
                      }}
                        onClick={() => setDeleteConfirmId(null)}
                      >
                        <div
                          onClick={e => e.stopPropagation()}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #e5e7eb',
                            borderRadius: '12px', padding: '1.5rem', maxWidth: '360px', width: '90%',
                            textAlign: 'center',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.1)'
                          }}
                        >
                          <Trash2 size={32} style={{ color: '#ef4444', margin: '0 auto 0.75rem' }} />
                          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#1a1a1a', marginBottom: '0.5rem' }}>
                            Delete Your Data?
                          </h3>
                          <p style={{ fontSize: '0.85rem', color: '#444444', marginBottom: '1.25rem' }}>
                            <strong>{upload.filename}</strong> will be permanently removed.
                          </p>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              style={{
                                padding: '0.5rem 1.25rem', borderRadius: '8px', fontSize: '0.85rem',
                                background: '#f3f4f6',
                                border: '1px solid #d1d5db', color: '#333333',
                                cursor: 'pointer', fontWeight: 500
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => deleteUpload(upload.id)}
                              style={{
                                padding: '0.5rem 1.25rem', borderRadius: '8px', fontSize: '0.85rem',
                                background: '#ef4444', border: 'none', color: '#ffffff',
                                cursor: 'pointer', fontWeight: 600
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Replace File Input */}
                    {replacingId === upload.id && (
                      <input
                        type="file"
                        ref={el => { if (el) el.click() }}
                        onChange={(e) => {
                          const file = e.target.files[0]
                          if (file) handleReplace(upload.id, file)
                          else setReplacingId(null)
                        }}
                        style={{ display: 'none' }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Panel 2: Add Sources ── */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <Upload size={20} className="icon-red" />
            <h2>Add Your Data</h2>
          </div>
        </div>
        <div style={{ padding: '1.25rem' }}>
          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragging ? '#dc2626' : 'var(--border-color, rgba(255,255,255,0.2))'}`,
              borderRadius: '10px',
              padding: '1.5rem',
              textAlign: 'center',
              background: isDragging ? 'rgba(220, 38, 38, 0.08)' : 'var(--surface-secondary, rgba(255,255,255,0.03))',
              cursor: 'pointer',
              transition: 'all 0.2s',
              opacity:consentAgreed?"1":"0.1"
            }}
            onClick={() => {if(consentAgreed) document.getElementById('sources-file-input').click()}}
          >
            <Upload size={36} style={{ color: '#dc2626', opacity: 0.6, marginBottom: '0.5rem' }} />
            <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
              Drop files here or click to browse
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              CSV, Excel, Word, PDF, Images, Video, Audio, JSON, and more
            </p>
            <input
              id="sources-file-input"
              type="file"
              multiple
              accept=".csv,.txt,.md,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.json,.xml,.zip,.mp3,.wav,.m4a,.aac,.mp4,.webm,.png,.jpg,.jpeg,.webp"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>

          {/* Screenshot tip */}
          <p style={{
            fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem',
            padding: '0.5rem 0.75rem',
            background: 'var(--surface-secondary, rgba(0,0,0,0.03))',
            borderRadius: '6px', lineHeight: 1.5
          }}>
            <strong style={{ color: 'var(--text-secondary)' }}>Tip:</strong> You can screenshot WhatsApp messages, text conversations, or any screen and drop them in as images. We accept PNG, JPG, and PDF screenshots.
          </p>

          {/* Pending files */}
          {pendingFiles.length > 0 && (
            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {pendingFiles.map((p, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.625rem',
                  padding: '0.5rem 0.75rem',
                  background: 'var(--surface-secondary, rgba(255,255,255,0.03))',
                  borderRadius: '8px'
                }}>
                  <Loader2 size={14} style={{ color: '#dc2626', animation: p.progress < 100 ? 'spin 1s linear infinite' : 'none', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.file.name}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: p.progress === 100 ? '#22c55e' : 'var(--text-muted)', flexShrink: 0 }}>
                    {p.progress === 100 ? 'Done' : 'Uploading...'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Sources Strip - Connectors */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.75rem' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600,
              background: 'rgba(220, 38, 38, 0.15)', color: '#dc2626',
              border: '1px solid rgba(220, 38, 38, 0.3)'
            }}>
              <Upload size={11} /> Upload
            </span>

            {/*<button
              onClick={gdriveConnected ? openGdrivePicker : connectGoogleDrive}
              disabled={gdriveLoading}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600,
                background: gdriveConnected ? 'rgba(59, 130, 246, 0.15)' : 'var(--surface-secondary, rgba(0,0,0,0.05))',
                color: gdriveConnected ? '#3b82f6' : 'var(--text-secondary)',
                border: gdriveConnected ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid var(--border-color)',
                cursor: gdriveLoading ? 'wait' : 'pointer', transition: 'all 0.2s'
              }}
            >
              {gdriveLoading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <HardDrive size={11} />}
              {gdriveConnected ? 'Google Drive' : 'Connect Drive'}
            </button>*/}

            {/*['NotebookLM', 'Dropbox', 'OneDrive'].map(name => (
              <span key={name} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: '999px', fontSize: '0.65rem', fontWeight: 600,
                background: 'var(--surface-secondary, rgba(0,0,0,0.03))',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-color)',
                opacity: 0.5
              }}>
                {name === 'NotebookLM' ? <FileText size={11} /> : <Cloud size={11} />} {name}
              </span>
            ))*/}
          </div>
          {/* Text Input Source */}
          <div style={{
            marginTop: '1rem',
            borderTop: '1px solid var(--border-color, rgba(255,255,255,0.1))',
            paddingTop: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <FileText size={16} style={{ color: '#dc2626' }} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>Paste Text Input</span>
            </div>

            <input
              type="text"
              value={textSourceLabel}
              disabled={!consentAgreed}
              onChange={(e) => setTextSourceLabel(e.target.value)}
              placeholder="Source label (e.g. Phone call notes, Email thread, Meeting notes, Key applications, Tech stack)"
              style={{
                width: '100%', padding: '0.5rem 0.625rem', marginBottom: '0.5rem',
                border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
                borderRadius: '6px', fontSize: '0.85rem',
                color: 'var(--text-primary)', background: 'var(--surface-secondary, rgba(255,255,255,0.03))',
                fontFamily: 'inherit', outline: 'none'
              }}
            />

            <textarea
              value={textSourceContent}
              disabled={!consentAgreed}
              onChange={(e) => setTextSourceContent(e.target.value)}
              placeholder="Paste raw text content here — call notes, email threads, chat logs, meeting minutes, application names, technologies used ..."
              rows={5}
              style={{
                width: '100%', padding: '0.625rem', marginBottom: '0.5rem',
                border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
                borderRadius: '6px', fontSize: '0.85rem',
                color: 'var(--text-primary)', background: 'var(--surface-secondary, rgba(255,255,255,0.03))',
                fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.5
              }}
            />
            <div style={{display:"flex",justifyContent:"center"}}>

            <button
              onClick={addTextSource}
              disabled={textSourceSaving || !textSourceContent.trim() || !consentAgreed}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                padding: '0.6rem',
                background: textSourceStatus === 'saved' ? '#22c55e' : !textSourceContent.trim() ? 'var(--surface-secondary, rgba(0,0,0,0.05))' : '#dc2626',
                color: textSourceStatus === 'saved' ? 'white' : !textSourceContent.trim() ? 'var(--text-muted)' : 'white',
                border: !textSourceContent.trim() && textSourceStatus !== 'saved' ? '1px solid var(--border-color)' : 'none',
                borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
                cursor: !textSourceContent.trim() || textSourceSaving ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {textSourceSaving ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : textSourceStatus === 'saved' ? <CheckCircle2 size={15} /> : <Plus size={15} />}
              {textSourceSaving ? 'Saving...' : textSourceStatus === 'saved' ? 'Your Data Added!' : 'Add Your Data'}
            </button>
            </div>
            {textSourceStatus === 'error' && (
              <p style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.375rem', textAlign: 'center' }}>
                {textSourceError}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Panel 3: APPS & SERVICES ── */}
      {/*<div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <Zap size={20} className="icon-red" />
            <h2>APPS & SERVICES</h2>
          </div>
        </div>
        <div style={{ padding: '1.25rem' }}>
         <textarea
             value={existingApps}
             disabled={!consentAgreed}
             onChange={(e) => setExistingApps(e.target.value)}
             placeholder="List your key apps and upload screenshots in your data section..."
             rows={5}
             style={{
               width: '100%', padding: '0.625rem', marginBottom: '0.5rem',
               border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
               borderRadius: '6px', fontSize: '0.85rem',
               color: 'var(--text-primary)', background: 'var(--surface-secondary, rgba(255,255,255,0.03))',
               fontFamily: 'inherit', outline: 'none', resize: 'vertical', lineHeight: 1.5
             }}
         />
          <div style={{display:"flex",justifyContent:"center"}}>

            <button
                onClick={addExistingApps}
                disabled={!consentAgreed}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                  padding: '0.6rem',
                  background: textSourceStatus === 'saved' ? '#22c55e' : !existingApps.trim() ? 'var(--surface-secondary, rgba(0,0,0,0.05))' : '#dc2626',
                  color: !existingApps.trim() ? 'var(--text-muted)' : 'white',
                  border: !existingApps.trim() ? '1px solid var(--border-color)' : 'none',
                  borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
                  cursor: !existingApps.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
            >
              {existingApps.trim() !== '' ? <CheckCircle2 size={15} /> : <Plus size={15} />}
              {'Add Existing Apps'}
            </button>
          </div>
        </div>
      </div>*/}

      {/* Google Drive File Picker Modal */}
      {showGdrivePicker && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            background: '#1a1a2e', borderRadius: '16px', width: '90%', maxWidth: '520px',
            maxHeight: '70vh', display: 'flex', flexDirection: 'column',
            border: '1px solid rgba(255, 255, 255, 0.1)', boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <HardDrive size={20} style={{ color: '#3b82f6' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'white', margin: 0 }}>Google Drive</h3>
              </div>
              <button
                onClick={() => { setShowGdrivePicker(false); setSelectedGdriveFiles([]) }}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            {gdriveFolderStack.length > 0 && (
              <button
                onClick={navigateGdriveBack}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '0.5rem 1.25rem',
                  background: 'none', border: 'none', borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                  color: '#3b82f6', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer'
                }}
              >
                <ChevronLeft size={16} /> Back
              </button>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
              {gdriveFiles.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: '2rem', fontSize: '0.85rem' }}>
                  No files found in this folder
                </p>
              ) : gdriveFiles.map(file => {
                const isSelected = selectedGdriveFiles.some(f => f.id === file.id)
                return (
                  <div
                    key={file.id}
                    onClick={() => file.isFolder ? navigateToGdriveFolder(file.id, file.name) : toggleGdriveFileSelection(file)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.625rem',
                      padding: '0.625rem 1.25rem', cursor: 'pointer',
                      background: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                      transition: 'background 0.15s'
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent' }}
                  >
                    {file.isFolder ? <FolderOpen size={18} style={{ color: '#facc15', flexShrink: 0 }} />
                      : isSelected ? <CheckCircle2 size={18} style={{ color: '#3b82f6', flexShrink: 0 }} />
                      : <FileText size={18} style={{ color: 'rgba(255,255,255,0.4)', flexShrink: 0 }} />}
                    <span style={{
                      fontSize: '0.85rem', color: isSelected ? '#3b82f6' : 'white',
                      fontWeight: isSelected ? 600 : 400, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1
                    }}>
                      {file.name}
                    </span>
                    {file.isFolder && <ChevronRight size={16} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />}
                  </div>
                )
              })}
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(255, 255, 255, 0.1)'
            }}>
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>
                {selectedGdriveFiles.length} file{selectedGdriveFiles.length !== 1 ? 's' : ''} selected
              </span>
              <button
                onClick={importGdriveFiles}
                disabled={selectedGdriveFiles.length === 0 || gdriveImporting}
                className="action-btn red"
                style={{
                  padding: '0.5rem 1.25rem', fontSize: '0.8rem',
                  opacity: selectedGdriveFiles.length === 0 ? 0.4 : 1,
                  cursor: selectedGdriveFiles.length === 0 ? 'not-allowed' : 'pointer'
                }}
              >
                {gdriveImporting ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Importing...</>
                  : <><Upload size={14} /> Import Files</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ============================================================
// ENRICH SCREEN
// ============================================================
const MODEL_LABELS = {
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6'
}

function EnrichScreen({ clientId, onComplete, preferredModel, activeEngagement, onNavigate }) {
  const [jobStatus, setJobStatus] = useState(null) // null | 'processing' | 'complete' | 'error'
  const [jobId, setJobId] = useState(null)
  const [currentStage, setCurrentStage] = useState(null)
  const [error, setError] = useState(null)
  const [showInfoPopover, setShowInfoPopover] = useState(false)
  const [stages, setStages] = useState([
    { id: 'extracting', label: 'Extracting Text', status: 'pending', icon: FileText },
    { id: 'transcribing', label: 'Transcribing Audio', status: 'pending', icon: Music },
    { id: 'preprocessing', label: 'Analyzing Each Document', status: 'pending', icon: Sparkles },
    { id: 'researching', label: 'Web Research', status: 'pending', icon: Sparkles },
    { id: 'analyzing', label: 'AI Analysis', status: 'pending', icon: Sparkles },
    { id: 'complete', label: 'Complete', status: 'pending', icon: CheckCircle }
  ])

  const startEnrichment = async () => {
    setError(null)
    setJobStatus('processing')
    setCurrentStage('extracting')
    updateStageStatus('extracting', 'active')

    try {
      // Trigger enrichment Lambda
      const response = await fetch(`${API_BASE}/enrich`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ client_id: clientId, model: preferredModel, engagement_id: activeEngagement?.id || undefined })
      })

      if (!response.ok) throw new Error('Failed to start enrichment')

      const data = await response.json()
      setJobId(data.job_id)

      // Start polling for status
      pollJobStatus(data.job_id)

    } catch (err) {
      setError(err.message)
      setJobStatus('error')
    }
  }

  const pollJobStatus = async (id) => {
    let errorCount = 0
    const maxErrors = 5
    const startTime = Date.now()
    const maxPollTime = 5 * 60 * 1000 // 5 minutes

    const pollInterval = setInterval(async () => {
      // Timeout after 5 minutes of polling
      if (Date.now() - startTime > maxPollTime) {
        clearInterval(pollInterval)
        setError('Enrichment is taking longer than expected. Check the Results tab — it may have completed.')
        setJobStatus('error')
        return
      }

      try {
        const response = await fetch(`${API_BASE}/results/${id}`, {
          headers: getAuthHeaders()
        })

        if (!response.ok) {
          errorCount++
          console.warn(`Poll error (${errorCount}/${maxErrors}): HTTP ${response.status}`)
          if (errorCount >= maxErrors) {
            clearInterval(pollInterval)
            setError('Lost connection to enrichment service')
            setJobStatus('error')
          }
          return
        }

        // Reset error count on successful response
        errorCount = 0
        const data = await response.json()

        // Update current stage based on backend response
        if (data.stage) {
          setCurrentStage(data.stage)
          updateStageStatus(data.stage, 'active')
        }

        // Check if complete
        if (data.status === 'complete') {
          clearInterval(pollInterval)
          setJobStatus('complete')
          updateStageStatus('complete', 'complete')

          // Auto-navigate to results after 1.5 seconds
          setTimeout(() => onComplete(), 1500)
        }

        // 'failed' is the new halt status (Stage 1 retry exhaustion etc.);
        // 'error' is the legacy status. Treat both as error-state for UI.
        if (data.status === 'error' || data.status === 'failed') {
          clearInterval(pollInterval)
          setJobStatus('error')
          setError(data.error || data.message || 'Enrichment failed')
        }

      } catch (err) {
        errorCount++
        console.warn(`Poll exception (${errorCount}/${maxErrors}):`, err.message)
        if (errorCount >= maxErrors) {
          clearInterval(pollInterval)
          setError('Lost connection to enrichment service')
          setJobStatus('error')
        }
      }
    }, 3000) // Poll every 3 seconds
  }

  const updateStageStatus = (stageId, status) => {
    setStages(prev => {
      const targetIndex = prev.findIndex(s => s.id === stageId)
      return prev.map((stage, i) => {
        if (i < targetIndex) {
          // All prior stages are complete
          return { ...stage, status: 'complete' }
        }
        if (i === targetIndex) {
          return { ...stage, status }
        }
        // All later stages stay pending
        return { ...stage, status: 'pending' }
      })
    })
  }

  return (
    <div>
      <ActiveEngagementBanner activeEngagement={activeEngagement} onNavigate={onNavigate} />
    <div className="panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <Sparkles size={20} className="icon-red" />
          <h2>AI Enrichment</h2>
          {jobStatus === 'processing' && (
            <span className="badge-count blue">Processing</span>
          )}
          {jobStatus === 'complete' && (
            <span className="badge-count green">Complete</span>
          )}
          <span style={{
            marginLeft: 'auto',
            fontSize: '0.7rem',
            fontWeight: 600,
            color: preferredModel.includes('opus') ? '#a855f7' : '#3b82f6',
            background: preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.1)' : 'rgba(59, 130, 246, 0.1)',
            padding: '3px 10px',
            borderRadius: '999px',
            border: `1px solid ${preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
          }}>
            Intellagentic Engine
          </span>
          <span style={{
            marginLeft: 'auto',
            fontSize: '0.7rem',
            fontWeight: 600,
            color: preferredModel.includes('opus') ? '#a855f7' : '#3b82f6',
            background: preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.1)' : 'rgba(59, 130, 246, 0.1)',
            padding: '3px 10px',
            borderRadius: '999px',
            border: `1px solid ${preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
          }}>
            {MODEL_LABELS[preferredModel] || preferredModel}
          </span>
        </div>
      </div>

      <div style={{ padding: '1.25rem' }}>
        {/* Not Started State */}
        {!jobStatus && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Sparkles size={64} style={{ color: '#dc2626', opacity: 0.5, margin: '0 auto 1.5rem' }} />
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
              Ready to Enrich Your Data
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.6 }}>
              Our AI will extract text from documents, transcribe audio files,<br />
              research your company online, and generate a comprehensive analysis.
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem' }}>
              <button
                onClick={startEnrichment}
                className="action-btn red"
                style={{ padding: '0.875rem 2rem', fontSize: '1rem' }}
              >
                <Sparkles size={20} />
                Start Enrichment
              </button>
              <button
                onClick={() => setShowInfoPopover(true)}
                style={{
                  background: 'none',
                  border: '2px solid var(--border-color)',
                  borderRadius: '50%',
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)',
                  transition: 'all 0.2s',
                  flexShrink: 0
                }}
                title="What happens when you click Enrich?"
              >
                <AlertCircle size={18} />
              </button>
            </div>

            {/* Enrichment Info Modal */}
            {showInfoPopover && (
              <div className="modal-overlay" onClick={() => setShowInfoPopover(false)}>
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: 400,
                    maxWidth: '90vw',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '12px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                    padding: '1.5rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                      What happens when you click Enrich?
                    </h4>
                    <button
                      onClick={() => setShowInfoPopover(false)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-secondary)',
                        padding: '0.25rem',
                        display: 'flex',
                        alignItems: 'center'
                      }}
                    >
                      <X size={18} />
                    </button>
                  </div>
                  {[
                    { num: '1', label: 'Extract', desc: 'Read all uploaded documents, transcribe audio files', icon: FileText },
                    { num: '2', label: 'Context', desc: 'Company info, pain points, and survival metrics guide the analysis', icon: Building2 },
                    { num: '3', label: 'Skills', desc: 'System + domain + client skills shape how AI thinks', icon: Database },
                    { num: '4', label: 'Web Research', desc: 'Company, competitors, and market research', icon: Globe },
                    { num: '5', label: 'AI Analysis', desc: `${MODEL_LABELS[preferredModel] || 'Claude'} produces MBA-level analysis`, icon: Sparkles },
                    { num: '6', label: 'Output', desc: 'Problems, architecture, schema, 7/14/21 day plan', icon: CheckCircle }
                  ].map(step => (
                    <div key={step.num} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', marginBottom: '0.75rem' }}>
                      <div style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: 'rgba(220, 38, 38, 0.1)',
                        color: '#dc2626',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        flexShrink: 0,
                        marginTop: 1
                      }}>
                        {step.num}
                      </div>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{step.label}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>{step.desc}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{
                    marginTop: '0.75rem',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}>
                    <span style={{
                      marginLeft: 'auto',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: preferredModel.includes('opus') ? '#a855f7' : '#3b82f6',
                      background: preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                      padding: '3px 10px',
                      borderRadius: '999px',
                      border: `1px solid ${preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
                    }}>
            Intellagentic Engine
          </span>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: preferredModel.includes('opus') ? '#a855f7' : '#3b82f6',
                      background: preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                      padding: '2px 8px',
                      borderRadius: '999px',
                      border: `1px solid ${preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
                    }}>
                      {MODEL_LABELS[preferredModel] || preferredModel}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Change model in Configuration
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Processing State */}
        {jobStatus === 'processing' && (
          <div>
            <div style={{
              background: 'rgba(59, 130, 246, 0.05)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '12px',
              padding: '1.25rem',
              marginBottom: '1.5rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <Loader2 size={20} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
                <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Processing your data...
                </h4>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                This may take a few minutes. We'll automatically advance when complete.
              </p>
            </div>

            {/* Progress Stages */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {stages.map((stage, index) => {
                const StageIcon = stage.icon
                const isActive = stage.status === 'active'
                const isComplete = stage.status === 'complete'
                const isPending = stage.status === 'pending'

                return (
                  <div
                    key={stage.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '1rem',
                      padding: '1rem',
                      background: isActive ? 'rgba(220, 38, 38, 0.05)' : isComplete ? 'rgba(34, 197, 94, 0.05)' : '#fafafa',
                      border: `1px solid ${isActive ? 'rgba(220, 38, 38, 0.2)' : isComplete ? 'rgba(34, 197, 94, 0.2)' : '#e5e5e5'}`,
                      borderRadius: '10px',
                      transition: 'all 0.3s'
                    }}
                  >
                    <div style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isComplete ? 'rgba(34, 197, 94, 0.15)' : isActive ? 'rgba(220, 38, 38, 0.15)' : '#e5e5e5',
                      flexShrink: 0
                    }}>
                      {isComplete ? (
                        <CheckCircle size={20} style={{ color: '#16a34a' }} />
                      ) : isActive ? (
                        <Loader2 size={20} style={{ color: '#dc2626', animation: 'spin 1s linear infinite' }} />
                      ) : (
                        <Clock size={20} style={{ color: '#9ca3af' }} />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{
                        fontSize: '0.9rem',
                        fontWeight: isActive || isComplete ? 600 : 500,
                        color: isActive ? '#dc2626' : isComplete ? '#16a34a' : '#666',
                        margin: 0
                      }}>
                        {stage.label}
                      </p>
                      {isActive && (
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
                          In progress...
                        </p>
                      )}
                      {isComplete && (
                        <p style={{ fontSize: '0.75rem', color: '#16a34a', margin: '0.25rem 0 0 0' }}>
                          Completed
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Complete State */}
        {jobStatus === 'complete' && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'rgba(34, 197, 94, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem'
            }}>
              <CheckCircle size={32} style={{ color: '#16a34a' }} />
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
              Enrichment Complete!
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Redirecting to results...
            </p>
          </div>
        )}

        {/* Error State */}
        {jobStatus === 'error' && (
          <div style={{
            background: 'rgba(220, 38, 38, 0.05)',
            border: '1px solid rgba(220, 38, 38, 0.2)',
            borderRadius: '12px',
            padding: '1.5rem',
            textAlign: 'center'
          }}>
            <AlertCircle size={48} style={{ color: '#dc2626', margin: '0 auto 1rem' }} />
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: '#dc2626' }}>
              Enrichment Failed
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {error || 'An error occurred during enrichment'}
            </p>
            <button
              onClick={startEnrichment}
              className="action-btn red"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
    </div>
  )
}

// ============================================================
// SKILLS SCREEN
// ============================================================
function SkillsScreen({ clientId, isAdmin, activeEngagement, onNavigate }) {
  const [skills, setSkills] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingSkill, setEditingSkill] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [inlineContent, setInlineContent] = useState('')
  const [inlineSaving, setInlineSaving] = useState(false)
  const [inlineDirty, setInlineDirty] = useState(false)

  useEffect(() => {
    fetchSkills()
  }, [clientId])

  const fetchSkills = async () => {
    try {
      setLoading(true)
      const url = clientId
        ? `${API_BASE}/skills?client_id=${clientId}`
        : `${API_BASE}/skills?scope=system`
      const res = await fetch(url, { headers: getAuthHeaders() })
      const data = await res.json()
      setSkills(data.skills || [])
    } catch (err) {
      console.error('Failed to fetch skills:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (skill) => {
    if (!confirm(`Delete skill "${skill.name}"?`)) return
    try {
      const res = await fetch(`${API_BASE}/skills?skill_id=${skill.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Delete failed') }
      setSkills(prev => prev.filter(s => s.id !== skill.id))
      if (expandedId === skill.id) setExpandedId(null)
    } catch (err) {
      alert('Failed to delete skill: ' + err.message)
    }
  }

  const toggleAccordion = (skill) => {
    if (expandedId === skill.id) {
      if (inlineDirty && !confirm('Discard unsaved changes?')) return
      setExpandedId(null)
      setInlineDirty(false)
    } else {
      if (inlineDirty && !confirm('Discard unsaved changes?')) return
      setExpandedId(skill.id)
      setInlineContent(skill.content || '')
      setInlineDirty(false)
    }
  }

  const handleInlineSave = async (skill) => {
    setInlineSaving(true)
    try {
      const res = await fetch(`${API_BASE}/skills`, {
        method: 'PUT',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill_id: skill.id, name: skill.name, content: inlineContent })
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Update failed') }
      setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, content: inlineContent } : s))
      setInlineDirty(false)
    } catch (err) {
      alert('Failed to save: ' + err.message)
    } finally {
      setInlineSaving(false)
    }
  }

  const exportAsMarkdown = (skill) => {
    const blob = new Blob([skill.content || ''], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${skill.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportAsDocx = (skill) => {
    // Build a simple .docx using HTML-in-docx approach (Office-compatible HTML file with .doc extension)
    const content = skill.content || ''
    const htmlLines = content.split('\n').map(line => {
      if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`
      if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`
      if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`
      if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`
      if (line.trim() === '') return '<br/>'
      return `<p>${line}</p>`
    }).join('\n')
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${skill.name}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.6;margin:1in;}h1{font-size:18pt;color:#1a1a2e;}h2{font-size:14pt;color:#333;border-bottom:1px solid #ddd;padding-bottom:4pt;}li{margin-left:0.25in;}</style>
</head><body>${htmlLines}</body></html>`
    const blob = new Blob([doc], { type: 'application/msword' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${skill.name.replace(/[^a-zA-Z0-9-_ ]/g, '')}.doc`
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportAllAsMarkdown = () => {
    const combined = skills.map(s => `# ${s.name}\n\n${s.content || ''}`).join('\n\n---\n\n')
    const blob = new Blob([combined], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'skills-export.md'
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportAllAsDocx = () => {
    const htmlSections = skills.map(s => {
      const lines = (s.content || '').split('\n').map(line => {
        if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`
        if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`
        if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`
        if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`
        if (line.trim() === '') return '<br/>'
        return `<p>${line}</p>`
      }).join('\n')
      return `<h1>${s.name}</h1>\n${lines}`
    }).join('\n<hr style="page-break-after:always;"/>\n')
    const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Skills Export</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.6;margin:1in;}h1{font-size:18pt;color:#1a1a2e;}h2{font-size:14pt;color:#333;border-bottom:1px solid #ddd;padding-bottom:4pt;}li{margin-left:0.25in;}hr{border:none;border-top:2px solid #ccc;margin:24pt 0;}</style>
</head><body>${htmlSections}</body></html>`
    const blob = new Blob([doc], { type: 'application/msword' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'skills-export.doc'
    a.click()
    URL.revokeObjectURL(url)
  }

  const systemSkills = skills.filter(s => s.scope === 'system')
  const clientSkills = skills.filter(s => s.scope === 'client')

  const canEdit = (skill) => skill.scope === 'client' || isAdmin

  const renderSkillRow = (skill) => {
    const isOpen = expandedId === skill.id
    const isSystem = skill.scope === 'system'
    const editable = canEdit(skill)

    return (
      <div key={skill.id} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
        {/* Accordion header */}
        <div
          onClick={() => toggleAccordion(skill)}
          style={{
            padding: '0.875rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            background: isOpen ? 'var(--bg-secondary)' : 'transparent',
            transition: 'background 0.15s'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
            <ChevronRight size={16} style={{
              flexShrink: 0, color: 'var(--text-muted)',
              transform: isOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.2s'
            }} />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0, wordBreak: 'break-word' }}>
              {skill.name}
            </h3>
            <span style={{
              fontSize: '0.6rem', fontWeight: 700,
              color: isSystem ? '#3b82f6' : 'var(--text-muted)',
              background: isSystem ? 'rgba(59,130,246,0.1)' : 'var(--bg-secondary)',
              padding: '2px 8px', borderRadius: 999, flexShrink: 0
            }}>{isSystem ? 'System' : 'Client'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => exportAsMarkdown(skill)} title="Export .md"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.4rem' }}>
              <FileText size={15} />
            </button>
            <button onClick={() => exportAsDocx(skill)} title="Export .doc"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0.4rem' }}>
              <Download size={15} />
            </button>
            {editable && (
              <button onClick={() => handleDelete(skill)} title="Delete"
                style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '0.4rem' }}>
                <Trash2 size={15} />
              </button>
            )}
          </div>
        </div>

        {/* Accordion body — inline editor */}
        {isOpen && (
          <div style={{ borderTop: '1px solid var(--border-color)', padding: '1rem 1.25rem' }}>
            {editable ? (
              <>
                <textarea
                  value={inlineContent}
                  onChange={e => { setInlineContent(e.target.value); setInlineDirty(true) }}
                  style={{
                    width: '100%',
                    minHeight: '250px',
                    padding: '0.75rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '0.8125rem',
                    fontFamily: 'monospace',
                    lineHeight: 1.6,
                    resize: 'vertical',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)'
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', color: inlineDirty ? '#f59e0b' : 'var(--text-muted)' }}>
                    {inlineDirty ? 'Unsaved changes' : 'No changes'}
                  </span>
                  <button
                    onClick={() => handleInlineSave(skill)}
                    disabled={!inlineDirty || inlineSaving}
                    style={{
                      padding: '0.5rem 1.25rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      background: inlineDirty ? '#dc2626' : 'var(--bg-secondary)',
                      color: inlineDirty ? 'white' : 'var(--text-muted)',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: inlineDirty ? 'pointer' : 'default',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    {inlineSaving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
                    Save
                  </button>
                </div>
              </>
            ) : (
              <pre style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '0.8125rem',
                fontFamily: 'monospace',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                margin: 0,
                maxHeight: '400px',
                overflow: 'auto'
              }}>
                {skill.content || 'No content'}
              </pre>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <ActiveEngagementBanner activeEngagement={activeEngagement} onNavigate={onNavigate} />
    <div className="panel">
      <div className="panel-header">
        <div className="panel-header-left">
          <Database size={20} className="icon-red" />
          <h2>Skills</h2>
          <span className="badge-count blue">{skills.length}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {skills.length > 0 && (
            <>
              <button
                onClick={exportAllAsDocx}
                className="action-btn"
                style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                title="Export all skills as .doc"
              >
                <Download size={16} />
                .doc
              </button>
              <button
                onClick={exportAllAsMarkdown}
                className="action-btn"
                style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                title="Export all skills as .md"
              >
                <FileText size={16} />
                .md
              </button>
            </>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="action-btn red"
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
          >
            <Plus size={18} />
            Add Skill
          </button>
        </div>
      </div>

      <div style={{ padding: '1.25rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Loader2 size={64} style={{ color: '#dc2626', opacity: 0.5, margin: '0 auto 1.5rem', animation: 'spin 1s linear infinite' }} />
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
              Loading Skills
            </h3>
          </div>
        ) : skills.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <Database size={64} style={{ color: '#dc2626', opacity: 0.5, margin: '0 auto 1.5rem' }} />
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary)' }}>
              No Skills Yet
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: 1.6 }}>
              Skills teach the AI what to focus on, what to ignore, and what success looks like<br />
              for your business. Think of them as instructions for your analyst.
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Click <strong>+ Add Skill</strong> above to get started.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {systemSkills.map(renderSkillRow)}

            {systemSkills.length > 0 && clientSkills.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border-color)', margin: '0.25rem 0', position: 'relative' }}>
                <span style={{
                  position: 'absolute', top: '-0.5rem', left: '1rem',
                  background: 'var(--bg-primary)', padding: '0 0.5rem',
                  fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500
                }}>Client Skills</span>
              </div>
            )}

            {clientSkills.map(renderSkillRow)}
          </div>
        )}
      </div>

      {/* Add/Edit Skill Modal */}
      {showAddModal && (
        <AddSkillModal
          clientId={clientId}
          isAdmin={isAdmin}
          skill={editingSkill}
          onClose={() => {
            setShowAddModal(false)
            setEditingSkill(null)
          }}
          onSave={() => {
            setShowAddModal(false)
            setEditingSkill(null)
            fetchSkills()
          }}
        />
      )}
    </div>
    </div>
  )
}

// ============================================================
// ADD SKILL MODAL
// ============================================================
function AddSkillModal({ clientId, isAdmin, skill, onClose, onSave }) {
  const [skillName, setSkillName] = useState(skill?.name || '')
  const [focusOn, setFocusOn] = useState('')
  const [ignoreAvoid, setIgnoreAvoid] = useState('')
  const [successCriteria, setSuccessCriteria] = useState('')
  const [industryTerms, setIndustryTerms] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadMode, setUploadMode] = useState(false)
  const [uploadedContent, setUploadedContent] = useState('')
  const [scope, setScope] = useState(skill?.scope || (clientId ? 'client' : 'system'))

  // Parse existing skill content back into structured fields when editing
  useEffect(() => {
    if (skill?.content) {
      const content = skill.content
      const extractSection = (heading) => {
        const regex = new RegExp(`## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`)
        const match = content.match(regex)
        if (!match) return ''
        return match[1].replace(/^[-*]\s+/gm, '').trim()
      }
      setFocusOn(extractSection('Focus Areas'))
      setIgnoreAvoid(extractSection('Ignore List'))
      setSuccessCriteria(extractSection('Success Criteria'))
      setIndustryTerms(extractSection('Industry Terms'))
      // If content doesn't parse into sections, switch to upload mode
      if (!extractSection('Focus Areas') && !extractSection('Ignore List') &&
          !extractSection('Success Criteria') && !extractSection('Industry Terms') && content.trim()) {
        setUploadMode(true)
        setUploadedContent(content)
      }
    }
  }, [skill])

  // Convert structured fields to markdown
  const buildMarkdown = () => {
    let md = `# ${skillName.trim()}\n\n`

    if (focusOn.trim()) {
      md += `## Focus Areas\n\n`
      focusOn.trim().split('\n').filter(l => l.trim()).forEach(line => {
        md += `- ${line.trim()}\n`
      })
      md += `\n`
    }

    if (ignoreAvoid.trim()) {
      md += `## Ignore List\n\n`
      ignoreAvoid.trim().split('\n').filter(l => l.trim()).forEach(line => {
        md += `- ${line.trim()}\n`
      })
      md += `\n`
    }

    if (successCriteria.trim()) {
      md += `## Success Criteria\n\n`
      successCriteria.trim().split('\n').filter(l => l.trim()).forEach(line => {
        md += `- ${line.trim()}\n`
      })
      md += `\n`
    }

    if (industryTerms.trim()) {
      md += `## Industry Terms\n\n`
      industryTerms.trim().split('\n').filter(l => l.trim()).forEach(line => {
        md += `- ${line.trim()}\n`
      })
      md += `\n`
    }

    return md
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return

    const validExts = ['.md', '.txt']
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
    if (!validExts.includes(ext)) {
      alert('Please upload a .md or .txt file')
      return
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      setUploadedContent(event.target.result)
      setSkillName(file.name.replace(/\.(md|txt)$/, ''))
    }
    reader.readAsText(file)
  }

  const handleSave = async () => {
    if (!skillName.trim()) {
      alert('Skill name is required')
      return
    }

    const content = uploadMode && uploadedContent ? uploadedContent : buildMarkdown()

    if (!uploadMode && !focusOn.trim() && !ignoreAvoid.trim() && !successCriteria.trim() && !industryTerms.trim()) {
      alert('Please fill in at least one field')
      return
    }

    setSaving(true)
    try {
      if (skill?.id) {
        // Update existing skill
        const res = await fetch(`${API_BASE}/skills`, {
          method: 'PUT',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ skill_id: skill.id, name: skillName.trim(), content })
        })
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Update failed') }
      } else {
        // Create new skill
        const body = { name: skillName.trim(), content, scope }
        if (scope === 'client') body.client_id = clientId
        const res = await fetch(`${API_BASE}/skills`, {
          method: 'POST',
          headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
        if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Create failed') }
      }
      onSave()
    } catch (err) {
      alert('Failed to save skill: ' + err.message)
      setSaving(false)
    }
  }

  const fieldStyle = {
    width: '100%',
    padding: '0.625rem',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontFamily: 'inherit',
    resize: 'vertical',
    lineHeight: 1.6
  }

  const labelStyle = {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    marginBottom: '0.25rem',
    color: 'var(--text-primary)'
  }

  const hintStyle = {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    margin: '0 0 0.5rem 0'
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Database size={20} className="icon-red" />
            <h2>{skill ? 'Edit Skill' : 'Add Skill'}</h2>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 1rem 0', lineHeight: 1.5 }}>
            Answer in plain English. The AI will use your answers to guide its analysis.
          </p>

          <div style={{ display: 'grid', gap: '1rem' }}>
            {/* Skill Name */}
            <div>
              <label style={labelStyle}>Skill Name *</label>
              <input
                type="text"
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="e.g., waste-management-analysis"
                style={{
                  width: '100%',
                  padding: '0.625rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            {/* Scope Selector (admin only, new skills only) */}
            {isAdmin && !skill && (
              <div>
                <label style={labelStyle}>Scope</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => setScope('client')}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 500,
                      border: scope === 'client' ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                      background: scope === 'client' ? 'rgba(59,130,246,0.08)' : 'transparent',
                      color: scope === 'client' ? '#3b82f6' : 'var(--text-secondary)',
                      cursor: 'pointer'
                    }}
                  >This client only</button>
                  <button
                    onClick={() => setScope('system')}
                    style={{
                      padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 500,
                      border: scope === 'system' ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                      background: scope === 'system' ? 'rgba(59,130,246,0.08)' : 'transparent',
                      color: scope === 'system' ? '#3b82f6' : 'var(--text-secondary)',
                      cursor: 'pointer'
                    }}
                  >System (all clients)</button>
                </div>
              </div>
            )}

            {/* Mode Toggle */}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                onClick={() => setUploadMode(!uploadMode)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#3b82f6',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  textDecoration: 'underline',
                  padding: 0
                }}
              >
                {uploadMode ? 'Use guided form instead' : 'Advanced: Upload .md file'}
              </button>
            </div>

            {uploadMode ? (
              /* Upload Mode for Power Users */
              <div>
                <label style={labelStyle}>Upload Skill File</label>
                <p style={hintStyle}>Upload a .md or .txt file with your custom skill instructions.</p>
                <input
                  type="file"
                  accept=".md,.txt"
                  onChange={handleFileUpload}
                  style={{
                    width: '100%',
                    padding: '0.625rem',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontFamily: 'inherit'
                  }}
                />
                {uploadedContent && (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.75rem',
                    background: 'rgba(34,197,94,0.08)',
                    borderRadius: '8px',
                    border: '1px solid rgba(34,197,94,0.2)'
                  }}>
                    <p style={{ fontSize: '0.8rem', color: '#22c55e', margin: 0, fontWeight: 500 }}>
                      <CheckCircle size={14} style={{ marginRight: '0.5rem', verticalAlign: 'middle' }} />
                      File loaded: {uploadedContent.length} characters
                    </p>
                  </div>
                )}
              </div>
            ) : (
              /* Structured Form Fields */
              <>
                {/* Focus On */}
                <div>
                  <label style={labelStyle}>What should the AI focus on?</label>
                  <p style={hintStyle}>What metrics, problems, or themes matter most? One idea per line.</p>
                  <textarea
                    value={focusOn}
                    onChange={(e) => setFocusOn(e.target.value)}
                    placeholder="Revenue trends and cash flow patterns&#10;Customer churn and retention rates&#10;Operational bottlenecks in the delivery process"
                    rows={3}
                    style={fieldStyle}
                  />
                </div>

                {/* Ignore / Avoid */}
                <div>
                  <label style={labelStyle}>What should the AI ignore or avoid?</label>
                  <p style={hintStyle}>Topics, assumptions, or recommendations to skip. One per line.</p>
                  <textarea
                    value={ignoreAvoid}
                    onChange={(e) => setIgnoreAvoid(e.target.value)}
                    placeholder="Don't recommend switching CRM platforms&#10;Skip branding and logo suggestions&#10;Ignore data older than 2023"
                    rows={3}
                    style={fieldStyle}
                  />
                </div>

                {/* Success Criteria */}
                <div>
                  <label style={labelStyle}>What does success look like?</label>
                  <p style={hintStyle}>What outcome would make this analysis valuable? One per line.</p>
                  <textarea
                    value={successCriteria}
                    onChange={(e) => setSuccessCriteria(e.target.value)}
                    placeholder="Identify the top 3 revenue leaks&#10;Propose a database schema for tracking routes&#10;Give a 21-day action plan with specific milestones"
                    rows={3}
                    style={fieldStyle}
                  />
                </div>

                {/* Industry Terms */}
                <div>
                  <label style={labelStyle}>Any industry terms or jargon to know?</label>
                  <p style={hintStyle}>Help the AI understand your domain. One term or phrase per line.</p>
                  <textarea
                    value={industryTerms}
                    onChange={(e) => setIndustryTerms(e.target.value)}
                    placeholder="MRR = Monthly Recurring Revenue&#10;Churn rate = percentage of customers lost per month&#10;ARR = Annual Recurring Revenue"
                    rows={3}
                    style={fieldStyle}
                  />
                </div>
              </>
            )}

            {/* Save Button */}
            <button
              onClick={handleSave}
              disabled={saving}
              className="action-btn red"
              style={{
                width: '100%',
                justifyContent: 'center',
                marginTop: '0.5rem',
                opacity: saving ? 0.7 : 1
              }}
            >
              {saving ? (
                <>
                  <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle size={18} />
                  {skill ? 'Update Skill' : 'Save Skill'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// CONFIGURATION SCREEN
// ============================================================
// ── Icon Library ──────────────────────────────────────────
const ICON_MAP = {
  Zap, Heart, Star, Send, Check,
  X, Edit2, Save, Home, Settings, User, Bell, Search,
  Calendar, Mail, Phone, MapPin, Upload, Play,
  ExternalLink, FileText, Globe, Package, CheckCircle2,
  Building2, Sparkles, Database, AlertCircle, AlertTriangle, TrendingUp, Clock,
  Download
}

const ICON_NAMES = Object.keys(ICON_MAP)

// ── Color Palette ─────────────────────────────────────────
const COLORS = [
  { name: 'Blue',   value: '#3b82f6' },
  { name: 'Green',  value: '#22c55e' },
  { name: 'Red',    value: '#ef4444' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Pink',   value: '#ec4899' },
  { name: 'Cyan',   value: '#06b6d4' },
  { name: 'Gray',   value: '#334155' }
]

const DEFAULT_BUTTONS = []

const BUTTON_PAGE_OPTIONS = [
  { value: 'welcome', label: 'Welcome' },
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'sources', label: 'Sources' },
  { value: 'enrich', label: 'Enrich' },
  { value: 'results', label: 'Results' },
  { value: 'skills', label: 'Skills' },
  { value: 'configuration', label: 'Configuration' },
]

// Internal route map for button navigation
const ROUTE_MAP = {
  '/dashboard': 'dashboard',
  '/upload': 'upload',
  '/sources': 'sources',
  '/enrich': 'enrich',
  '/results': 'results',
  '/skills': 'skills',
  '/configuration': 'configuration'
}

function PageActionButtons({ page, systemButtons, configButtons, onNavigate }) {
  const allButtons = [...(systemButtons || []), ...(configButtons || [])]
  const filtered = allButtons.filter(btn => {
    if (btn.hidden) return false
    const showOn = btn.showOn || btn.show_on || ['welcome']
    if (!Array.isArray(showOn) || !showOn.includes(page)) return false
    // These render inside their respective section headers, not in generic bar
    if (page === 'results' && (btn.label === 'Rapid Prototype' || btn.name === 'Rapid Prototype')) return false
    if (page === 'results' && (btn.label === 'Download Brief' || btn.label === 'Download .docx' || btn.name === 'Download Brief' || btn.name === 'Download .docx')) return false
    if (page === 'results' && (btn.label === 'Download Deck' || btn.name === 'Download Deck')) return false
    if (page === 'results' && (btn.label === 'Build in Streamline' || btn.name === 'Build in Streamline')) return false
    if (page === 'configuration' && (btn.label === 'Rapid Prototype' || btn.name === 'Rapid Prototype')) return false
    return true
  })
  if (filtered.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem', justifyContent: 'flex-end' }}>
      {filtered.map((btn, i) => {
        const IconComp = ICON_MAP[btn.icon] || Zap
        const isRoute = btn.url && btn.url.startsWith('/') && ROUTE_MAP[btn.url]
        return (
          <button
            key={btn.id || i}
            onClick={() => {
              if (isRoute && onNavigate) onNavigate(ROUTE_MAP[btn.url])
              else if (btn.url) window.open(btn.url, '_blank')
            }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.45rem 0.9rem',
              background: btn.color || '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
              boxShadow: `0 2px 8px ${btn.color || '#3b82f6'}30`, transition: 'all 0.2s'
            }}
          >
            <IconComp size={15} />
            {btn.label}
          </button>
        )
      })}
    </div>
  )
}

function SystemSkillsPanel({ C }) {
  const [systemSkills, setSystemSkills] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/skills?scope=system`, { headers: getAuthHeaders() })
        const data = await res.json()
        setSystemSkills(data.skills || [])
      } catch (e) {
        console.error('Failed to load system skills:', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div className="panel" style={{ marginTop: '1rem' }}>
      <div className="panel-header">
        <div className="panel-header-left">
          <Lock size={20} className="icon-red" />
          <h2>System Skills</h2>
          <span className="badge-count">{loading ? '...' : systemSkills.length}</span>
        </div>
      </div>
      <div style={{ padding: '1.25rem' }}>
        <p style={{ fontSize: '0.75rem', color: C.muted, marginBottom: '0.875rem', lineHeight: 1.5 }}>
          System skills are injected into every enrichment call before client skills. Manage them on the Skills screen.
        </p>
        <div className="system-skill-grid" style={{ display: 'grid', gap: '0.5rem' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '1rem' }}>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: C.muted }} />
            </div>
          ) : systemSkills.map((skill) => (
            <div key={skill.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.625rem 0.875rem', background: C.surface, borderRadius: '8px',
              border: `1px solid ${C.border}`
            }}>
              <Lock size={14} style={{ color: C.muted, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: C.text }}>{skill.name}</div>
                <div className="system-skill-desc" style={{
                  fontSize: '0.7rem', color: C.muted, marginTop: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>{skill.content ? skill.content.substring(0, 100).replace(/[#\n]/g, ' ').trim() : ''}</div>
              </div>
              <span style={{
                fontSize: '0.6rem', fontWeight: 600, color: '#3b82f6',
                background: 'rgba(59,130,246,0.1)', padding: '2px 6px', borderRadius: 999,
                flexShrink: 0
              }}>System</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}


function ConfigurationScreen({ theme, toggleTheme, buttons, setButtons, systemButtons, setSystemButtons, preferredModel, setPreferredModel, clientId, inWorkspace, isAdmin, companyName,
  // PR 4 hotfix: SF state lifted to App.
  salesforceConnected, setSalesforceConnected,
  salesforceInstanceUrl, setSalesforceInstanceUrl,
  salesforceError, setSalesforceError,
  salesforceLastPullAt, setSalesforceLastPullAt,
  salesforceUnresolvedConflicts, setSalesforceUnresolvedConflicts,
  salesforceStatusLoaded, onNavigate,
}) {
  const isDark = theme === 'dark'
  const [editingId, setEditingId] = useState(null)
  const [draggedId, setDraggedId] = useState(null)
  const [sysEditingId, setSysEditingId] = useState(null)
  const [sysDraggedId, setSysDraggedId] = useState(null)
  const [webhookEnabled, setWebhookEnabled] = useState(false)
  const [webhookLoaded, setWebhookLoaded] = useState(false)
  const [webhookSaving, setWebhookSaving] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookUrlSaving, setWebhookUrlSaving] = useState(false)
  const [webhookUrlSaved, setWebhookUrlSaved] = useState(false)
  // System-level webhook config (dashboard mode, admin only)
  const [sysWebhookEnabled, setSysWebhookEnabled] = useState(false)
  const [sysWebhookSaving, setSysWebhookSaving] = useState(false)
  const [sysInviteUrl, setSysInviteUrl] = useState('')
  const [sysInviteSaving, setSysInviteSaving] = useState(false)
  const [sysInviteSaved, setSysInviteSaved] = useState(false)
  const [sysEnrichmentUrl, setSysEnrichmentUrl] = useState('')
  const [sysEnrichmentSaving, setSysEnrichmentSaving] = useState(false)
  const [sysEnrichmentSaved, setSysEnrichmentSaved] = useState(false)
  // S3 Encryption toggle state
  const [sysS3EncEnabled, setSysS3EncEnabled] = useState(true)
  const [s3ConvertModal, setS3ConvertModal] = useState(false)
  const [s3ConvertAction, setS3ConvertAction] = useState(null)
  const [s3ConvertProgress, setS3ConvertProgress] = useState(null)
  const [s3ConvertRunning, setS3ConvertRunning] = useState(false)
  // HubSpot integration state
  const [hubspotConnected, setHubspotConnected] = useState(false)
  const [hubspotLastSync, setHubspotLastSync] = useState(null)
  const [hubspotLoading, setHubspotLoading] = useState(false)
  const [hubspotConnecting, setHubspotConnecting] = useState(false)
  const [hubspotStatusLoaded, setHubspotStatusLoaded] = useState(false)
  const [hubspotSyncResult, setHubspotSyncResult] = useState(null)
  // PR 4 hotfix: SF state lifted to App, passed in as props.
  // (Local state still needed for in-screen interactions: connecting,
  // pulling, syncResult. The shared cross-screen state — connected,
  // instance_url, error, last_pull_at, unresolved_conflicts,
  // statusLoaded — comes from props.)
  const [salesforceConnecting, setSalesforceConnecting] = useState(false)
  const [salesforcePulling, setSalesforcePulling] = useState(false)
  const [salesforceSyncResult, setSalesforceSyncResult] = useState(null)

  useEffect(() => {
    if (inWorkspace && clientId) {
      fetch(`${API_BASE}/clients?client_id=${clientId}`, { headers: getAuthHeaders() })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            setWebhookEnabled(!!data.streamline_webhook_enabled)
            setWebhookUrl(data.streamline_webhook_url || '')
          }
        })
        .catch(() => {})
        .finally(() => setWebhookLoaded(true))
    } else if (!inWorkspace && isAdmin) {
      fetch(`${API_BASE}/system-config`, { headers: getAuthHeaders() })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            setSysInviteUrl(data.invite_webhook_url || '')
            setSysEnrichmentUrl(data.enrichment_webhook_url || '')
            setSysWebhookEnabled(data.streamline_webhook_enabled === 'true')
            setSysS3EncEnabled(data.s3_encryption_enabled !== 'false')
          }
        })
        .catch(() => {})
        .finally(() => setWebhookLoaded(true))
      // Fetch HubSpot connection status
      fetch(`${API_BASE}/hubspot/status`, { headers: getAuthHeaders() })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data) {
            setHubspotConnected(!!data.connected)
            setHubspotLastSync(data.last_sync || null)
          }
        })
        .catch(() => {})
        .finally(() => setHubspotStatusLoaded(true))
      // PR 4 hotfix: SF status fetch moved up to App so the sidebar
      // count is populated before Configuration is mounted. This block
      // stays as a re-fetch trigger if the user navigates into
      // Configuration after a long idle (next time, App's mount
      // useEffect won't re-run on its own).
      fetch(`${API_BASE}/salesforce/status`, { headers: getAuthHeaders() })
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && setSalesforceConnected) {
            setSalesforceConnected(!!data.connected)
            setSalesforceInstanceUrl(data.instance_url || null)
            setSalesforceError(data.error || null)
            setSalesforceLastPullAt(data.last_pull_at || null)
            setSalesforceUnresolvedConflicts(data.unresolved_conflicts || 0)
          }
        })
        .catch(() => {})
    } else {
      setWebhookLoaded(true)
    }
  }, [clientId, inWorkspace, isAdmin])

  const toggleWebhook = async () => {
    if (!clientId) return
    const newValue = !webhookEnabled
    setWebhookEnabled(newValue)
    setWebhookSaving(true)
    try {
      // Need company_name for the PUT — fetch current then update
      const getRes = await fetch(`${API_BASE}/clients?client_id=${clientId}`, { headers: getAuthHeaders() })
      if (getRes.ok) {
        const current = await getRes.json()
        await fetch(`${API_BASE}/clients`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            client_id: clientId,
            company_name: current.company_name,
            website: current.website,
            contacts: current.contacts || [],
            industry: current.industry,
            description: current.description,
            painPoint: current.painPoint,
            streamline_webhook_enabled: newValue
          })
        })
      }
    } catch (err) {
      console.error('Failed to save webhook setting:', err)
      setWebhookEnabled(!newValue) // revert on error
    }
    setWebhookSaving(false)
  }

  const saveWebhookUrl = async () => {
    if (!clientId) return
    setWebhookUrlSaving(true)
    setWebhookUrlSaved(false)
    try {
      const getRes = await fetch(`${API_BASE}/clients?client_id=${clientId}`, { headers: getAuthHeaders() })
      if (getRes.ok) {
        const current = await getRes.json()
        await fetch(`${API_BASE}/clients`, {
          method: 'PUT',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            client_id: clientId,
            company_name: current.company_name,
            website: current.website,
            contacts: current.contacts || [],
            industry: current.industry,
            description: current.description,
            painPoint: current.painPoint,
            streamline_webhook_url: webhookUrl
          })
        })
        setWebhookUrlSaved(true)
        setTimeout(() => setWebhookUrlSaved(false), 2000)
      }
    } catch (err) {
      console.error('Failed to save webhook URL:', err)
    }
    setWebhookUrlSaving(false)
  }

  const toggleSysWebhook = async () => {
    const newValue = !sysWebhookEnabled
    setSysWebhookEnabled(newValue)
    setSysWebhookSaving(true)
    try {
      await fetch(`${API_BASE}/system-config`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ config_key: 'streamline_webhook_enabled', config_value: String(newValue) })
      })
    } catch (err) {
      console.error('Failed to save system webhook toggle:', err)
      setSysWebhookEnabled(!newValue)
    }
    setSysWebhookSaving(false)
  }

  const runS3Convert = async () => {
    setS3ConvertRunning(true)
    setS3ConvertProgress({ total: 0, completed: 0, results: [] })
    try {
      const res = await fetch(`${API_BASE}/system-config/s3-encryption-convert`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ action: s3ConvertAction })
      })
      const data = await res.json()
      const results = data.results || []
      for (let i = 0; i < results.length; i++) {
        await new Promise(r => setTimeout(r, 120))
        setS3ConvertProgress({
          total: data.total_clients,
          completed: i + 1,
          results: results.slice(0, i + 1)
        })
      }
      setSysS3EncEnabled(data.s3_encryption_enabled)
    } catch (err) {
      console.error('S3 conversion failed:', err)
    }
    setS3ConvertRunning(false)
  }

  const saveSysConfig = async (key, value, setSaving, setSaved) => {
    setSaving(true)
    setSaved(false)
    try {
      await fetch(`${API_BASE}/system-config`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ config_key: key, config_value: value })
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error(`Failed to save ${key}:`, err)
    }
    setSaving(false)
  }

  // Theme-aware colors matching reference C object
  const C = {
    bg:      isDark ? '#0d1117' : '#f6f8fa',
    surface: isDark ? '#161b22' : '#ffffff',
    border:  isDark ? '#30363d' : '#d0d7de',
    text:    isDark ? '#e6edf3' : '#1f2328',
    muted:   isDark ? '#8b949e' : '#656d76',
  }

  // ── Button Operations ─────────────────────────────────────
  const addButton = () => {
    const newBtn = {
      id: Date.now(),
      label: 'New Button',
      color: '#3b82f6',
      icon: 'Zap',
      url: ''
    }
    let newButtons = [...buttons,newBtn]
    setButtons(newButtons)
    setEditingId(newBtn.id)
  }

  const deleteButton = (id) => {
    let newButtons = buttons.filter(b => b.id !== id)
    setButtons(newButtons, [id])
    if (editingId === id) setEditingId(null)
  }

  const duplicateButton = (btn) => {
    const newBtn = { ...btn, id: Date.now(), label: `${btn.label} (copy)` }
    let newButtons = [...buttons,newBtn]
    setButtons(newButtons)
  }

  const updateButton = (id, field, value) => {
    let newButtons = buttons.map(b => b.id === id ? { ...b, [field]: value } : b)
    setButtons(newButtons)
  }

  // ── Drag & Drop ───────────────────────────────────────────
  const handleDragStart = (id) => setDraggedId(id)

  const handleDragOver = (e, targetId) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetId) return
    const draggedIdx = buttons.findIndex(b => b.id === draggedId)
    const targetIdx = buttons.findIndex(b => b.id === targetId)
    const newButtons = [...buttons]
    const [removed] = newButtons.splice(draggedIdx, 1)
    newButtons.splice(targetIdx, 0, removed)
    setButtons(newButtons)
  }

  const handleDragEnd = () => setDraggedId(null)

  // ── System Button Operations ─────────────────────────────
  const addSysButton = () => {
    const newBtn = { id: Date.now(), label: 'New Button', color: '#3b82f6', icon: 'Zap', url: '', showOn: [] }
    let newButtons = [...systemButtons, newBtn]
    setSystemButtons(newButtons)
    setSysEditingId(newBtn.id)
  }
  const deleteSysButton = (id) => {
    let newButtons = systemButtons.filter(b => b.id !== id)
    setSystemButtons(newButtons, [id])
    if (sysEditingId === id) setSysEditingId(null)
  }
  const duplicateSysButton = (btn) => {
    const newBtn = { ...btn, id: Date.now(), label: `${btn.label} (copy)` }
    let newButtons = [...systemButtons, newBtn]
    setSystemButtons(newButtons)
  }
  const updateSysButton = (id, field, value) => {
    let newButtons = systemButtons.map(b => b.id === id ? { ...b, [field]: value } : b);
    setSystemButtons(newButtons)
  }
  const handleSysDragStart = (id) => setSysDraggedId(id)
  const handleSysDragOver = (e, targetId) => {
    e.preventDefault()
    if (!sysDraggedId || sysDraggedId === targetId) return
    const draggedIdx = systemButtons.findIndex(b => b.id === sysDraggedId)
    const targetIdx = systemButtons.findIndex(b => b.id === targetId)
    const newButtons = [...systemButtons]
    const [removed] = newButtons.splice(draggedIdx, 1)
    newButtons.splice(targetIdx, 0, removed)
    setSystemButtons(newButtons)
  }
  const handleSysDragEnd = () => setSysDraggedId(null)

  // Helper to render a button editor panel (reused for system and client buttons)
  const renderButtonEditor = (btnList, ops) => {
    const { onAdd, onDelete, onDuplicate, onUpdate, onDragStart, onDragOver, onDragEnd, editId, setEditId, dragId, readOnly, showSystemBadge } = ops
    return (
      <div style={{ animation: 'fadeIn .5s .1s ease backwards' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {readOnly ? 'System Buttons' : 'Configure Buttons'}
          </h2>
          {!readOnly && (
            <button onClick={onAdd} className="btn-hover" style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none',
              background: '#3b82f6', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              transition: 'all .2s', boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
            }}>
              <Plus size={16} /> Add Button
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {btnList.map((btn, index) => {
            const isEditing = editId === btn.id
            const IconComp = ICON_MAP[btn.icon] || Zap
            return (
              <div key={btn.id} draggable={!readOnly}
                onDragStart={() => !readOnly && onDragStart(btn.id)}
                onDragOver={(e) => !readOnly && onDragOver(e, btn.id)}
                onDragEnd={() => !readOnly && onDragEnd()}
                className="card-hover"
                style={{
                  padding: 16, background: C.surface, border: `2px solid ${isEditing ? '#3b82f6' : C.border}`,
                  borderRadius: 12, cursor: readOnly ? 'default' : 'grab', transition: 'all .2s',
                  animation: `slideIn .3s ${index * 0.05}s ease backwards`,
                  opacity: btn.hidden ? 0.45 : readOnly ? 0.8 : 1
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isEditing ? 16 : 0 }}>
                  {!readOnly && <GripVertical size={18} color={C.muted} style={{ cursor: 'grab' }} />}
                  {readOnly && <Lock size={16} color={C.muted} />}
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: `${btn.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <IconComp size={18} color={btn.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>{btn.label}</span>
                      {showSystemBadge && (
                        <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#3b82f6', background: 'rgba(59,130,246,0.1)', padding: '2px 8px', borderRadius: 999 }}>System</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                      {COLORS.find(c => c.value === btn.color)?.name || 'Custom'} &bull; {btn.icon}
                    </div>
                    {btn.url && <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{btn.url}</div>}
                  </div>
                  {!readOnly && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => onUpdate(btn.id, 'hidden', !btn.hidden)} title={btn.hidden ? 'Show button' : 'Hide button'} style={{
                        width: 32, height: 32, borderRadius: 6, border: 'none',
                        background: btn.hidden ? '#f59e0b20' : `${C.muted}20`, color: btn.hidden ? '#f59e0b' : C.muted,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s'
                      }}>{btn.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                      <button onClick={() => setEditId(isEditing ? null : btn.id)} style={{
                        width: 32, height: 32, borderRadius: 6, border: 'none',
                        background: isEditing ? '#3b82f6' : `${C.muted}20`, color: isEditing ? 'white' : C.muted,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s'
                      }}><Edit2 size={14} /></button>
                      <button onClick={() => onDuplicate(btn)} style={{
                        width: 32, height: 32, borderRadius: 6, border: 'none',
                        background: `${C.muted}20`, color: C.muted, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s'
                      }}><Copy size={14} /></button>
                      <button onClick={() => onDelete(btn.id)} style={{
                        width: 32, height: 32, borderRadius: 6, border: 'none',
                        background: '#ef444420', color: '#ef4444', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s'
                      }}><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
                {/* Inline Editing Panel */}
                {isEditing && !readOnly && (
                  <div style={{ paddingTop: 16, borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 12, animation: 'fadeIn .3s ease' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Label</label>
                      <input type="text" value={btn.label} onChange={(e) => onUpdate(btn.id, 'label', e.target.value)}
                        style={{ width: '100%', padding: '8px 12px', background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, outline: 'none' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>URL</label>
                      <input type="text" value={btn.url || ''} onChange={(e) => onUpdate(btn.id, 'url', e.target.value)}
                        placeholder="/enrich, /skills, or https://..."
                        style={{ width: '100%', padding: '8px 12px', background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, outline: 'none' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Color</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
                        {COLORS.map((c) => (
                          <button key={c.value} onClick={() => onUpdate(btn.id, 'color', c.value)} style={{
                            height: 36, borderRadius: 8, border: btn.color === c.value ? `2px solid ${c.value}` : '2px solid transparent',
                            background: `${c.value}30`, cursor: 'pointer', position: 'relative', transition: 'all .2s'
                          }}>
                            {btn.color === c.value && <Check size={16} color={c.value} style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Icon</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
                        {ICON_NAMES.map((iconName) => {
                          const Icon = ICON_MAP[iconName]
                          return (
                            <button key={iconName} onClick={() => onUpdate(btn.id, 'icon', iconName)} style={{
                              aspectRatio: '1', borderRadius: 8,
                              border: btn.icon === iconName ? `2px solid ${btn.color}` : `1px solid ${C.border}`,
                              background: btn.icon === iconName ? `${btn.color}20` : C.bg,
                              color: btn.icon === iconName ? btn.color : C.muted,
                              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .2s'
                            }}><Icon size={16} /></button>
                          )
                        })}
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Show on pages</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {/* None option */}
                        {(() => {
                          const showOn = btn.showOn || btn.show_on || ['welcome']
                          const isNone = !Array.isArray(showOn) || showOn.length === 0
                          return (
                            <label style={{
                              display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                              borderRadius: 6, fontSize: 12, cursor: 'pointer',
                              background: isNone ? '#ef444415' : C.bg,
                              border: `1px solid ${isNone ? '#ef4444' : C.border}`,
                              color: isNone ? '#ef4444' : C.muted, fontWeight: isNone ? 600 : 400,
                            }}>
                              <input type="checkbox" checked={isNone}
                                onChange={() => onUpdate(btn.id, 'showOn', isNone ? ['welcome'] : [])}
                                style={{ width: 14, height: 14, accentColor: '#ef4444' }}
                              />
                              None
                            </label>
                          )
                        })()}
                        {BUTTON_PAGE_OPTIONS.map(opt => {
                          const showOn = btn.showOn || btn.show_on || ['welcome']
                          const isNone = !Array.isArray(showOn) || showOn.length === 0
                          const checked = !isNone && showOn.includes(opt.value)
                          return (
                            <label key={opt.value} style={{
                              display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
                              borderRadius: 6, fontSize: 12, cursor: 'pointer',
                              background: checked ? `${btn.color || '#3b82f6'}15` : C.bg,
                              border: `1px solid ${checked ? (btn.color || '#3b82f6') : C.border}`,
                              color: checked ? (btn.color || '#3b82f6') : C.muted, fontWeight: checked ? 600 : 400,
                              opacity: isNone ? 0.4 : 1,
                            }}>
                              <input type="checkbox" checked={checked} disabled={isNone}
                                onChange={() => {
                                  const curr = Array.isArray(showOn) ? [...showOn] : []
                                  const next = checked ? curr.filter(v => v !== opt.value) : [...curr, opt.value]
                                  onUpdate(btn.id, 'showOn', next)
                                }}
                                style={{ width: 14, height: 14, accentColor: btn.color || '#3b82f6' }}
                              />
                              {opt.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {btnList.length === 0 && !readOnly && (
            <div style={{ padding: 32, textAlign: 'center', color: C.muted, background: C.surface, border: `2px solid ${C.border}`, borderRadius: 12 }}>
              <Settings size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
              <p>No buttons configured. Click "+ Add Button" to get started.</p>
            </div>
          )}
          {btnList.length === 0 && readOnly && (
            <div style={{ padding: 16, textAlign: 'center', color: C.muted, fontSize: '0.8rem' }}>
              No system buttons configured.
            </div>
          )}
        </div>
      </div>
    )
  }

  // Render live preview for buttons
  const renderButtonPreview = (btnList, title) => (
    <div style={{ animation: 'fadeIn .5s .2s ease backwards' }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 16 }}>{title || 'Live Preview'}</h2>
      <div style={{ marginTop: 24, padding: 16, background: C.surface, border: `2px solid ${C.border}`, borderRadius: 16, minHeight: 200 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {btnList.map((btn) => {
            const IconComp = ICON_MAP[btn.icon] || Zap
            return (
              <button key={btn.id} className="btn-hover" style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px',
                background: btn.color, color: 'white', border: 'none', borderRadius: 10,
                cursor: 'pointer', fontSize: 14, fontWeight: 500, boxShadow: `0 4px 12px ${btn.color}40`, transition: 'all .2s'
              }}>
                <IconComp size={18} />
                {btn.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  return (
    <div>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(-12px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .btn-hover:hover { opacity: .8; transform: translateY(-1px); }
        .card-hover:hover { border-color: ${C.text}40 !important; }
      `}</style>

      {/* Configuration Header */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <Settings size={20} className="icon-red" />
            <h2>{inWorkspace ? `Client Configuration` : 'System Configuration'}</h2>
          </div>
        </div>
        {inWorkspace && companyName && (
          <div style={{ padding: '0 1.25rem 1rem', fontSize: '0.8125rem', color: C.muted }}>
            {companyName}
          </div>
        )}
      </div>

      {/* AI Model Selector */}
      <div className="panel" style={{ marginTop: '1rem' }}>
        <div className="panel-header">
          <h2>AI Model</h2>
        </div>
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
          {[
            { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', desc: 'Latest flagship, best analysis and reasoning', color: '#a855f7' },
            { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', desc: 'Previous flagship', color: '#8b5cf6' },
            { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', desc: 'Balanced speed and quality', color: '#3b82f6' }
          ].map(m => {
            const isSelected = preferredModel === m.id
            return (
                <button
                    key={m.id}
                    onClick={() => setPreferredModel(m.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.875rem 1rem',
                      background: isSelected ? `${m.color}12` : C.surface,
                      borderRadius: 10,
                      border: `2px solid ${isSelected ? m.color : C.border}`,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      textAlign: 'left',
                      width: '100%'
                    }}
                >
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%',
                    border: `2px solid ${isSelected ? m.color : C.muted}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    {isSelected && <div style={{ width: 10, height: 10, borderRadius: '50%', background: m.color }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: C.text }}>{m.label}</div>
                    <div style={{ fontSize: '0.75rem', color: C.muted, marginTop: 2 }}>{m.desc}</div>
                  </div>
                  {isSelected && (
                      <span style={{
                        fontSize: '0.65rem', fontWeight: 700, color: m.color,
                        background: `${m.color}18`, padding: '2px 8px', borderRadius: 999
                      }}>Active</span>
                  )}
                </button>
            )
          })}
        </div>
      </div>

      {/* ── System Configuration (dashboard mode, admin) ── */}
      {!inWorkspace && isAdmin && (
        <>
          <div className="panel" style={{ marginTop: '1rem' }}>
            <div className="panel-header">
              <div className="panel-header-left">
                <Send size={20} className="icon-red" />
                <h2>Global Webhook URLs</h2>
              </div>
            </div>
            <div style={{ padding: '1.25rem' }}>
              <p style={{ fontSize: '0.75rem', color: C.muted, marginBottom: '0.75rem', lineHeight: 1.4 }}>
                Default webhook URLs used when no per-client override is set.
              </p>

              {/* Invite Webhook URL */}
              <div style={{
                padding: '0.625rem 0.875rem',
                background: `${C.muted}10`,
                borderRadius: 8,
                border: `1px solid ${C.border}`
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invite Webhook URL</span>
                  {sysInviteSaving && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: C.muted }} />}
                  {sysInviteSaved && <span style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 600 }}>Saved</span>}
                </div>
                <input
                  type="url"
                  value={sysInviteUrl}
                  onChange={e => setSysInviteUrl(e.target.value)}
                  onBlur={() => saveSysConfig('invite_webhook_url', sysInviteUrl, setSysInviteSaving, setSysInviteSaved)}
                  placeholder="https://hooks.example.com/invite-webhook"
                  style={{
                    width: '100%', marginTop: 4, padding: '0.5rem 0.625rem',
                    fontSize: '0.8rem', fontFamily: 'monospace', color: C.text,
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: 6, outline: 'none', boxSizing: 'border-box', wordBreak: 'break-all'
                  }}
                />
              </div>

              {/* Default Enrichment Webhook URL */}
              <div style={{
                marginTop: '0.5rem',
                padding: '0.625rem 0.875rem',
                background: `${C.muted}10`,
                borderRadius: 8,
                border: `1px solid ${C.border}`
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Default Enrichment Webhook URL</span>
                  {sysEnrichmentSaving && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: C.muted }} />}
                  {sysEnrichmentSaved && <span style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 600 }}>Saved</span>}
                </div>
                <input
                  type="url"
                  value={sysEnrichmentUrl}
                  onChange={e => setSysEnrichmentUrl(e.target.value)}
                  onBlur={() => saveSysConfig('enrichment_webhook_url', sysEnrichmentUrl, setSysEnrichmentSaving, setSysEnrichmentSaved)}
                  placeholder="https://hooks.example.com/webhook"
                  style={{
                    width: '100%', marginTop: 4, padding: '0.5rem 0.625rem',
                    fontSize: '0.8rem', fontFamily: 'monospace', color: C.text,
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: 6, outline: 'none', boxSizing: 'border-box', wordBreak: 'break-all'
                  }}
                />
              </div>

              {/* Send to Streamline toggle */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '0.75rem',
                padding: '1rem',
                background: C.surface,
                borderRadius: 10,
                border: `1px solid ${C.border}`
              }}>
                <div style={{ flex: 1, marginRight: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {/*<span style={{ fontSize: '0.9rem', fontWeight: 500, color: C.text }}>
                      Send to Streamline
                    </span>*/}
                    {sysWebhookSaving && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: C.muted }} />}
                  </div>
                  <p style={{ fontSize: '0.75rem', color: C.muted, marginTop: 4, lineHeight: 1.4 }}>
                    Automatically send enrichment results to Streamline when enrichment completes (default for all clients)
                  </p>
                </div>
                <button
                  onClick={toggleSysWebhook}
                  disabled={sysWebhookSaving}
                  style={{
                    width: 52, height: 28, borderRadius: 14, border: 'none',
                    background: sysWebhookEnabled ? '#dc2626' : '#e5e5e5',
                    position: 'relative', cursor: sysWebhookSaving ? 'wait' : 'pointer',
                    transition: 'all 0.2s', flexShrink: 0
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', background: 'white',
                    position: 'absolute', top: 3, left: sysWebhookEnabled ? 27 : 3,
                    transition: 'all 0.2s', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)'
                  }} />
                </button>
              </div>

              <p style={{ fontSize: '0.7rem', color: C.muted, marginTop: '0.625rem', lineHeight: 1.4 }}>
                Per-client settings (in client Configuration) override these system defaults.
              </p>

              {/* S3 Encryption Toggle */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginTop: '0.75rem', padding: '1rem',
                background: C.surface, borderRadius: 10, border: `1px solid ${C.border}`
              }}>
                <div style={{ flex: 1, marginRight: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>S3 File Encryption</span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: C.muted, marginTop: 4, lineHeight: 1.4 }}>
                    Encrypt all client files stored in S3 (skills, configs, results, uploads).
                    Toggling will convert all existing files.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setS3ConvertAction(sysS3EncEnabled ? 'decrypt' : 'encrypt')
                    setS3ConvertProgress(null)
                    setS3ConvertModal(true)
                  }}
                  style={{
                    width: 52, height: 28, borderRadius: 14, border: 'none',
                    background: sysS3EncEnabled ? '#dc2626' : '#e5e5e5',
                    position: 'relative', cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', background: 'white',
                    position: 'absolute', top: 3, left: sysS3EncEnabled ? 27 : 3,
                    transition: 'all 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                  }} />
                </button>
              </div>
            </div>
          </div>

          {/* ── Integrations (combined card: HubSpot + Salesforce) ── */}
          <div className="panel" data-dxo="integrations" style={{ marginTop: '1rem' }}>
            <div className="panel-header">
              <div className="panel-header-left">
                <Cloud size={20} className="icon-red" />
                <h2>Integrations</h2>
              </div>
            </div>
            <div style={{ padding: '1.25rem' }}>

              {/* HubSpot sub-section */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>HubSpot</h3>
                {hubspotStatusLoaded && (
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '0.2rem 0.6rem',
                    borderRadius: 12,
                    background: hubspotConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(220, 38, 38, 0.1)',
                    color: hubspotConnected ? '#22c55e' : '#dc2626',
                  }}>
                    {hubspotConnected ? 'Connected' : 'Disconnected'}
                  </span>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', color: C.muted, marginBottom: '0.75rem', lineHeight: 1.4 }}>
                Bi-directional sync between XO Capture and HubSpot CRM. Companies, contacts, and enrichment data are synced automatically.
              </p>

              {!hubspotConnected && (
                <div>
                  <button
                    onClick={async () => {
                      setHubspotConnecting(true)
                      try {
                        const res = await fetch(`${API_BASE}/hubspot/connect`, {
                          method: 'POST',
                          headers: getAuthHeaders(),
                        })
                        const data = await res.json()
                        if (res.ok && data.authorization_url) {
                          window.open(data.authorization_url, '_blank')
                        } else if (res.ok && data.connected) {
                          setHubspotConnected(true)
                        } else if (res.ok && data.status === 'private_app' && !data.connected) {
                          alert('Private App token not configured. Set HUBSPOT_PRIVATE_TOKEN in the Lambda environment.')
                        } else {
                          alert(data.error || 'Failed to initiate HubSpot connection')
                        }
                      } catch (err) {
                        alert('Failed to connect: ' + err.message)
                      }
                      setHubspotConnecting(false)
                    }}
                    disabled={hubspotConnecting}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.625rem 1.25rem',
                      background: '#ff7a59', color: '#fff',
                      border: 'none', borderRadius: 8, fontSize: '0.85rem',
                      fontWeight: 600, cursor: hubspotConnecting ? 'wait' : 'pointer',
                      opacity: hubspotConnecting ? 0.7 : 1,
                    }}
                    title="Uses a Private App token configured in the Lambda environment. OAuth flow not required."
                  >
                    {hubspotConnecting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Link size={16} />}
                    {hubspotConnecting ? 'Connecting...' : 'Connect HubSpot'}
                  </button>
                  <p style={{ fontSize: '0.65rem', color: C.muted, marginTop: '0.35rem', fontStyle: 'italic' }}>Uses a Private App token configured in the Lambda environment.</p>
                </div>
              )}

              {hubspotConnected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <p style={{ fontSize: '0.65rem', color: C.muted, fontStyle: 'italic', margin: 0 }}>Connected via Private App token. OAuth flow not required.</p>
                  {hubspotLastSync && (
                    <div style={{
                      padding: '0.5rem 0.75rem',
                      background: `${C.muted}10`,
                      borderRadius: 8,
                      border: `1px solid ${C.border}`,
                      fontSize: '0.75rem', color: C.muted,
                    }}>
                      <span style={{ fontWeight: 600 }}>Last sync:</span>{' '}
                      {new Date(hubspotLastSync).toLocaleString()}
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      setHubspotLoading(true)
                      try {
                        const res = await fetch(`${API_BASE}/hubspot/sync`, {
                          method: 'POST',
                          headers: getAuthHeaders(),
                        })
                        const data = await res.json()
                        if (res.ok && data.status === 'complete') {
                          setHubspotLastSync(data.last_sync)
                          setHubspotSyncResult({ success: true, msg: `Synced ${data.pushed?.accounts || 0} accounts, ${data.pushed?.clients || 0} clients. Pulled ${data.pulled?.clients_created || 0} new, ${data.pulled?.clients_updated || 0} updated.${(data.conflicts || []).length > 0 ? ` ${data.conflicts.length} conflict(s).` : ''}` })
                        } else {
                          setHubspotSyncResult({ success: false, msg: data.error || 'Sync returned unexpected response' })
                        }
                      } catch (err) {
                        setHubspotSyncResult({ success: false, msg: 'Sync request failed: ' + err.message })
                      }
                      setHubspotLoading(false)
                      setTimeout(() => setHubspotSyncResult(null), 8000)
                    }}
                    disabled={hubspotLoading}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.625rem 1.25rem',
                      background: '#ff7a59', color: '#fff',
                      border: 'none', borderRadius: 8, fontSize: '0.85rem',
                      fontWeight: 600, cursor: hubspotLoading ? 'wait' : 'pointer',
                      opacity: hubspotLoading ? 0.7 : 1, alignSelf: 'flex-start',
                    }}
                  >
                    {hubspotLoading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={16} />}
                    {hubspotLoading ? 'Syncing...' : 'Sync Now'}
                  </button>
                  {hubspotSyncResult && (
                    <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', borderRadius: 8, fontSize: '0.75rem', background: hubspotSyncResult.success ? '#f0fdf4' : '#fef2f2', color: hubspotSyncResult.success ? '#166534' : '#991b1b', border: `1px solid ${hubspotSyncResult.success ? '#22c55e' : '#dc2626'}` }}>
                      {hubspotSyncResult.success ? <CheckCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> : <AlertTriangle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />}
                      {hubspotSyncResult.msg}
                    </div>
                  )}
                </div>
              )}

              {/* Divider between the two integrations */}
              <hr style={{ margin: '1.5rem 0', border: 'none', borderTop: '1px solid var(--border-color, #e5e7eb)' }} />

              {/* Salesforce sub-section */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Salesforce</h3>
                {salesforceStatusLoaded && (
                  <span style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '0.2rem 0.6rem',
                    borderRadius: 12,
                    background: salesforceConnected ? 'rgba(34, 197, 94, 0.15)' :
                                (salesforceError === 'token_expired' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(220, 38, 38, 0.1)'),
                    color: salesforceConnected ? '#22c55e' :
                           (salesforceError === 'token_expired' ? '#a16207' : '#dc2626'),
                  }}>
                    {salesforceConnected ? 'Connected' :
                     (salesforceError === 'token_expired' ? 'Token expired' : 'Disconnected')}
                  </span>
                )}
              </div>
              <div>
              <p style={{ fontSize: '0.75rem', color: C.muted, marginBottom: '0.75rem', lineHeight: 1.4 }}>
                Bi-directional sync with Salesforce. Per-tenant — each account connects its own SF org. Pull and webhook deliver Account, Contact, and Opportunity changes into XO; push sends XO clients + engagement summaries to SF.
              </p>

              {salesforceError === 'token_expired' && (
                <div style={{
                  padding: '0.5rem 0.75rem', marginBottom: '0.75rem',
                  background: '#fefce8', color: '#854d0e',
                  border: '1px solid #eab308', borderRadius: 8,
                  fontSize: '0.75rem',
                }}>
                  <AlertTriangle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                  Salesforce session expired — reconnect to resume sync.
                </div>
              )}

              {!salesforceConnected && (
                <button
                  onClick={async () => {
                    setSalesforceConnecting(true)
                    try {
                      const res = await fetch(`${API_BASE}/salesforce/connect`, {
                        method: 'POST',
                        headers: getAuthHeaders(),
                      })
                      const data = await res.json()
                      if (res.ok && data.auth_url) {
                        // Open SF authorize URL in a new window. The backend
                        // handles the OAuth callback (consumes nonce, stores
                        // tokens) and returns a self-closing HTML page. Poll
                        // /salesforce/status after the window closes.
                        const popup = window.open(data.auth_url, '_blank', 'width=600,height=750')
                        const pollStatus = setInterval(() => {
                          if (popup && popup.closed) {
                            clearInterval(pollStatus)
                            fetch(`${API_BASE}/salesforce/status`, { headers: getAuthHeaders() })
                              .then(r => r.ok ? r.json() : null)
                              .then(d => {
                                if (d) {
                                  setSalesforceConnected(!!d.connected)
                                  setSalesforceInstanceUrl(d.instance_url || null)
                                  setSalesforceError(d.error || null)
                                  setSalesforceLastPullAt(d.last_pull_at || null)
                                  setSalesforceUnresolvedConflicts(d.unresolved_conflicts || 0)
                                }
                                setSalesforceConnecting(false)
                              })
                              .catch(() => setSalesforceConnecting(false))
                          }
                        }, 800)
                      } else {
                        alert(data.error || 'Failed to initiate Salesforce connection')
                        setSalesforceConnecting(false)
                      }
                    } catch (err) {
                      alert('Failed to connect: ' + err.message)
                      setSalesforceConnecting(false)
                    }
                  }}
                  disabled={salesforceConnecting}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.625rem 1.25rem',
                    background: '#00a1e0', color: '#fff',
                    border: 'none', borderRadius: 8, fontSize: '0.85rem',
                    fontWeight: 600, cursor: salesforceConnecting ? 'wait' : 'pointer',
                    opacity: salesforceConnecting ? 0.7 : 1,
                  }}
                >
                  {salesforceConnecting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Link size={16} />}
                  {salesforceConnecting ? 'Connecting...' : (salesforceError === 'token_expired' ? 'Reconnect Salesforce' : 'Connect Salesforce')}
                </button>
              )}

              {salesforceConnected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {salesforceInstanceUrl && (
                    <div style={{
                      padding: '0.5rem 0.75rem',
                      background: `${C.muted}10`,
                      borderRadius: 8, border: `1px solid ${C.border}`,
                      fontSize: '0.75rem', color: C.muted,
                    }}>
                      <span style={{ fontWeight: 600 }}>Org:</span>{' '}
                      <a href={salesforceInstanceUrl} target="_blank" rel="noopener noreferrer"
                         style={{ color: C.muted }}>
                        {salesforceInstanceUrl.replace(/^https?:\/\//, '')}
                      </a>
                    </div>
                  )}
                  {salesforceLastPullAt && (
                    <div style={{
                      padding: '0.5rem 0.75rem',
                      background: `${C.muted}10`,
                      borderRadius: 8, border: `1px solid ${C.border}`,
                      fontSize: '0.75rem', color: C.muted,
                    }}>
                      <span style={{ fontWeight: 600 }}>Last pull:</span>{' '}
                      {new Date(salesforceLastPullAt).toLocaleString()}
                    </div>
                  )}
                  {salesforceUnresolvedConflicts > 0 && (
                    <button
                      onClick={() => onNavigate && onNavigate('sf-conflicts')}
                      style={{
                        padding: '0.5rem 0.75rem',
                        background: '#fefce8', color: '#854d0e',
                        border: '1px solid #eab308', borderRadius: 8,
                        fontSize: '0.75rem', cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <AlertTriangle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                      {salesforceUnresolvedConflicts} unresolved conflict{salesforceUnresolvedConflicts === 1 ? '' : 's'} — open conflicts page
                    </button>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      onClick={async () => {
                        setSalesforcePulling(true)
                        try {
                          const res = await fetch(`${API_BASE}/salesforce/sync/pull`, {
                            method: 'POST', headers: getAuthHeaders(),
                          })
                          const data = await res.json()
                          if (res.ok && data.pulled) {
                            const a = data.accounts || {}
                            const c = data.contacts || {}
                            const o = data.opportunities || {}
                            setSalesforceSyncResult({
                              success: true,
                              msg: `Accounts: ${a.pulled || 0} updated, ${a.created || 0} new. ` +
                                   `Contacts: ${c.inserted || 0} new, ${c.pulled || 0} updated. ` +
                                   `Opportunities: ${o.pulled || 0} updated, ${o.created || 0} new.`,
                            })
                            // Refresh status to pick up new last_pull_at + conflict count.
                            fetch(`${API_BASE}/salesforce/status`, { headers: getAuthHeaders() })
                              .then(r => r.ok ? r.json() : null)
                              .then(d => {
                                if (d) {
                                  setSalesforceLastPullAt(d.last_pull_at || null)
                                  setSalesforceUnresolvedConflicts(d.unresolved_conflicts || 0)
                                }
                              })
                              .catch(() => {})
                          } else {
                            setSalesforceSyncResult({ success: false, msg: data.error || 'Pull returned an unexpected response' })
                          }
                        } catch (err) {
                          setSalesforceSyncResult({ success: false, msg: 'Pull request failed: ' + err.message })
                        }
                        setSalesforcePulling(false)
                        setTimeout(() => setSalesforceSyncResult(null), 8000)
                      }}
                      disabled={salesforcePulling}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.625rem 1.25rem',
                        background: '#00a1e0', color: '#fff',
                        border: 'none', borderRadius: 8, fontSize: '0.85rem',
                        fontWeight: 600, cursor: salesforcePulling ? 'wait' : 'pointer',
                        opacity: salesforcePulling ? 0.7 : 1,
                      }}
                    >
                      {salesforcePulling ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={16} />}
                      {salesforcePulling ? 'Pulling...' : 'Sync Now'}
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm('Disconnect Salesforce? Tokens will be cleared from this account.')) return
                        try {
                          const res = await fetch(`${API_BASE}/salesforce/disconnect`, {
                            method: 'POST', headers: getAuthHeaders(),
                          })
                          if (res.ok) {
                            setSalesforceConnected(false)
                            setSalesforceInstanceUrl(null)
                            setSalesforceError(null)
                          } else {
                            const data = await res.json()
                            alert(data.error || 'Failed to disconnect')
                          }
                        } catch (err) {
                          alert('Disconnect failed: ' + err.message)
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0.625rem 1.25rem',
                        background: 'transparent', color: C.muted,
                        border: `1px solid ${C.border}`, borderRadius: 8,
                        fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                  {salesforceSyncResult && (
                    <div style={{
                      marginTop: '0.5rem', padding: '0.5rem 0.75rem',
                      borderRadius: 8, fontSize: '0.75rem',
                      background: salesforceSyncResult.success ? '#f0fdf4' : '#fef2f2',
                      color: salesforceSyncResult.success ? '#166534' : '#991b1b',
                      border: `1px solid ${salesforceSyncResult.success ? '#22c55e' : '#dc2626'}`,
                    }}>
                      {salesforceSyncResult.success
                        ? <CheckCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                        : <AlertTriangle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />}
                      {salesforceSyncResult.msg}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          </div>

          {/* ── System Buttons Config ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr' : '1fr',
            gap: 28,
            marginTop: '1rem'
          }}>
            {renderButtonEditor(systemButtons || [], {
              onAdd: addSysButton, onDelete: deleteSysButton, onDuplicate: duplicateSysButton,
              onUpdate: updateSysButton, onDragStart: handleSysDragStart, onDragOver: handleSysDragOver,
              onDragEnd: handleSysDragEnd, editId: sysEditingId, setEditId: setSysEditingId,
              dragId: sysDraggedId, readOnly: false, showSystemBadge: true
            })}
            {renderButtonPreview(systemButtons || [], 'System Buttons Preview')}
          </div>
          <p style={{ fontSize: '0.7rem', color: C.muted, marginTop: '0.5rem', lineHeight: 1.4 }}>
            System buttons appear on every client's Welcome screen before client-specific buttons.
          </p>
        </>
      )}

      {/* ── Client Configuration (workspace mode) ── */}
      {inWorkspace && (<>

      {/* Theme Toggle */}
      <div className="panel" style={{ marginTop: '1rem' }}>
        <div className="panel-header">
          <h2>Theme</h2>
        </div>
        <div style={{ padding: '1.25rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem',
            background: C.surface,
            borderRadius: 10,
            border: `1px solid ${C.border}`
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {isDark ? <Moon size={20} className="icon-blue" /> : <Sun size={20} className="icon-amber" />}
              <span style={{ fontSize: '0.9rem', fontWeight: 500, color: C.text }}>
                {isDark ? 'Dark Mode' : 'Light Mode'}
              </span>
            </div>
            <button
              onClick={toggleTheme}
              style={{
                width: 52,
                height: 28,
                borderRadius: 14,
                border: 'none',
                background: isDark ? '#3b82f6' : '#e5e5e5',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: 'white',
                position: 'absolute',
                top: 3,
                left: isDark ? 27 : 3,
                transition: 'all 0.2s',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)'
              }} />
            </button>
          </div>
        </div>
      </div>

      {/* System Skills — dynamic from API */}
      <SystemSkillsPanel C={C} />

      {/* Per-Client Streamline Webhook */}
      {clientId && (
        <div className="panel" style={{ marginTop: '1rem' }}>
          <div className="panel-header">
            <div className="panel-header-left">
              <Send size={20} className="icon-red" />
              <h2>Streamline Webhook</h2>
            </div>
          </div>
          <div style={{ padding: '1.25rem' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1rem',
              background: C.surface,
              borderRadius: 10,
              border: `1px solid ${C.border}`
            }}>
              <div style={{ flex: 1, marginRight: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 500, color: C.text }}>
                    Send to Streamline
                  </span>
                  {webhookSaving && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: C.muted }} />}
                </div>
                <p style={{ fontSize: '0.75rem', color: C.muted, marginTop: 4, lineHeight: 1.4 }}>
                  Automatically send enrichment results to Streamline when enrichment completes
                </p>
              </div>
              <button
                onClick={toggleWebhook}
                disabled={webhookSaving}
                style={{
                  width: 52, height: 28, borderRadius: 14, border: 'none',
                  background: webhookEnabled ? '#dc2626' : '#e5e5e5',
                  position: 'relative', cursor: webhookSaving ? 'wait' : 'pointer',
                  transition: 'all 0.2s', flexShrink: 0
                }}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', background: 'white',
                  position: 'absolute', top: 3, left: webhookEnabled ? 27 : 3,
                  transition: 'all 0.2s', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)'
                }} />
              </button>
            </div>
            <div style={{
              marginTop: '0.75rem',
              padding: '0.625rem 0.875rem',
              background: `${C.muted}10`,
              borderRadius: 8,
              border: `1px solid ${C.border}`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Enrichment Webhook URL (override)</span>
                {webhookUrlSaving && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: C.muted }} />}
                {webhookUrlSaved && <span style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 600 }}>Saved</span>}
              </div>
              <input
                type="url"
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                onBlur={saveWebhookUrl}
                placeholder="Leave blank to use system default"
                style={{
                  width: '100%', marginTop: 4, padding: '0.5rem 0.625rem',
                  fontSize: '0.8rem', fontFamily: 'monospace', color: C.text,
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 6, outline: 'none', boxSizing: 'border-box', wordBreak: 'break-all'
                }}
              />
            </div>
            <p style={{ fontSize: '0.7rem', color: C.muted, marginTop: '0.625rem', lineHeight: 1.4 }}>
              Per-client URL overrides the system default. Leave blank to use the system webhook URL.
            </p>
          </div>
        </div>
      )}

      {/* System Buttons (read-only for non-admin, shown in client config) */}
      {(systemButtons || []).length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          {renderButtonEditor(systemButtons || [], {
            onAdd: () => {}, onDelete: () => {}, onDuplicate: () => {}, onUpdate: () => {},
            onDragStart: () => {}, onDragOver: () => {}, onDragEnd: () => {},
            editId: null, setEditId: () => {}, dragId: null, readOnly: true, showSystemBadge: true
          })}
        </div>
      )}

      {/* Client Buttons — Configure & Live Preview */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: window.innerWidth > 600 ? '1fr 1fr' : '1fr',
        gap: 28,
        marginTop: '1rem'
      }}>
        {renderButtonEditor(buttons, {
          onAdd: addButton, onDelete: deleteButton, onDuplicate: duplicateButton,
          onUpdate: updateButton, onDragStart: handleDragStart, onDragOver: handleDragOver,
          onDragEnd: handleDragEnd, editId: editingId, setEditId: setEditingId,
          dragId: draggedId, readOnly: false, showSystemBadge: false
        })}
        {renderButtonPreview([...(systemButtons || []), ...buttons], 'Live Preview')}
      </div>

      </>)}

      {/* ── S3 Encryption Convert Modal ── */}
      {s3ConvertModal && (
        <div className="modal-overlay" onClick={() => !s3ConvertRunning && (setS3ConvertModal(false), setS3ConvertProgress(null))}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div className="modal-header">
              <h3 style={{ margin: 0, fontSize: '1rem' }}>{s3ConvertAction === 'encrypt' ? 'Encrypt' : 'Decrypt'} All S3 Files</h3>
              {!s3ConvertRunning && (
                <button className="modal-close" onClick={() => { setS3ConvertModal(false); setS3ConvertProgress(null) }}><X size={18} /></button>
              )}
            </div>
            <div className="modal-body" style={{ padding: '1.25rem' }}>
              {!s3ConvertRunning && !s3ConvertProgress && (
                <>
                  <p style={{ fontSize: '0.85rem', color: C.text, lineHeight: 1.5, margin: 0 }}>
                    This will <strong>{s3ConvertAction}</strong> all S3 files for every client.
                    {s3ConvertAction === 'decrypt' ? ' Files will be stored as plaintext. This is reversible.' : " Files will be encrypted with each client's key."}
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                    <button onClick={() => { setS3ConvertModal(false); setS3ConvertProgress(null) }}
                      style={{ padding: '0.5rem 1rem', background: C.surface, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: '0.8rem', cursor: 'pointer' }}>Cancel</button>
                    <button onClick={runS3Convert}
                      style={{ padding: '0.5rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                      {s3ConvertAction === 'encrypt' ? 'Encrypt All' : 'Decrypt All'}</button>
                  </div>
                </>
              )}
              {s3ConvertRunning && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontSize: '0.85rem', color: C.text }}>Converting... {s3ConvertProgress?.completed || 0} / {s3ConvertProgress?.total || '?'} clients</span>
                  </div>
                  <div style={{ width: '100%', height: 6, background: `${C.muted}30`, borderRadius: 3, overflow: 'hidden', marginBottom: '1rem' }}>
                    <div style={{ width: `${s3ConvertProgress?.total ? (s3ConvertProgress.completed / s3ConvertProgress.total * 100) : 0}%`, height: '100%', background: '#dc2626', borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ maxHeight: 250, overflowY: 'auto', fontSize: '0.75rem', fontFamily: 'monospace', background: C.bg, borderRadius: 6, padding: '0.75rem', border: `1px solid ${C.border}` }}>
                    {(s3ConvertProgress?.results || []).map((r, i) => (
                      <div key={i} style={{ padding: '0.25rem 0', borderBottom: `1px solid ${C.border}`, color: r.status === 'error' ? '#ef4444' : r.status === 'skipped' ? C.muted : '#22c55e' }}>
                        {r.status === 'done' ? '\u2713' : r.status === 'error' ? '\u2717' : '\u2013'}{' '}{r.company_name} &mdash; {r.files_converted} files{r.status === 'skipped' ? ` (${r.reason})` : ''}{r.errors?.length > 0 ? ` [${r.errors.length} errors]` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!s3ConvertRunning && s3ConvertProgress && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: '#22c55e' }}>
                    <CheckCircle2 size={20} /><span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Conversion complete</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: C.muted, marginBottom: '1rem' }}>{s3ConvertProgress.completed} / {s3ConvertProgress.total} clients processed. S3 encryption is now <strong>{s3ConvertAction === 'encrypt' ? 'enabled' : 'disabled'}</strong>.</p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => { setS3ConvertModal(false); setS3ConvertProgress(null); setSysS3EncEnabled(s3ConvertAction === 'encrypt') }}
                      style={{ padding: '0.5rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>Done</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// RESULTS SCREEN
// ============================================================
function renderMarkdown(text) {
  if (!text) return null
  // Strip backslash escapes before processing (e.g. \*\* → **)
  text = text.replace(/\\\*/g, '*').replace(/\\-/g, '-').replace(/\\\|/g, '|')
  // Split on fenced code blocks first, then process each segment
  const segments = text.split(/(```[\s\S]*?```)/g)
  let blockKey = 0
  return segments.map((segment) => {
    // Fenced code block
    if (segment.startsWith('```') && segment.endsWith('```')) {
      const code = segment.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
      return (
        <pre key={blockKey++} style={{
          fontFamily: 'Monaco, Menlo, Consolas, monospace', whiteSpace: 'pre',
          overflowX: 'auto', background: 'var(--bg-card-alt, #f5f5f5)',
          border: '1px solid var(--border-color, #e0e0e0)',
          padding: '12px', borderRadius: 4, fontSize: '0.75rem', lineHeight: 1.5, margin: '0.75rem 0'
        }}>{code}</pre>
      )
    }
    // Regular content — split into paragraphs
    return segment.split('\n\n').map((para) => {
      if (!para.trim()) return null
      const lines = para.split('\n')
      const isBulletBlock = lines.every(l => /^\s*[-*·•]\s/.test(l) || !l.trim())
      const isNumberedBlock = lines.every(l => /^\s*\d+\.\s/.test(l) || !l.trim())
      if (isBulletBlock) {
        return (
          <ul key={blockKey++} style={{ margin: '0.5rem 0 0.75rem 1.5rem', fontSize: '0.95rem', lineHeight: 1.7, listStyleType: 'disc' }}>
            {lines.filter(l => l.trim()).map((l, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: l.replace(/^\s*[-*·•]\s/, '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
            ))}
          </ul>
        )
      }
      if (isNumberedBlock) {
        return (
          <ol key={blockKey++} style={{ margin: '0.5rem 0 0.75rem 1.5rem', fontSize: '0.95rem', lineHeight: 1.7 }}>
            {lines.filter(l => l.trim()).map((l, j) => (
              <li key={j} dangerouslySetInnerHTML={{ __html: l.replace(/^\s*\d+\.\s/, '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
            ))}
          </ol>
        )
      }
      const html = para.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br/>')
      return <p key={blockKey++} style={{ margin: '0.5rem 0', fontSize: '0.95rem', lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: html }} />
    })
  })
}

// ── Growth Deck data helpers (ported from xo-deck-download Lambda) ──
function cleanDeckText(text) {
  if (!text) return ''
  return text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^(?:Problem|Workflow|Outcome|Solution|Issue):\s*/i, '')
    .replace(/^\d+\.\s*/, '')
    .trim()
}

function firstDeckSentence(text, maxLen) {
  if (!text) return ''
  const cleaned = cleanDeckText(text)
  const m = cleaned.match(/^((?:[^.!?\n]|\.(?=\d))+[.!?]?)/)
  let s = m ? m[1].trim() : cleaned.substring(0, 120).trim()
  if (maxLen && s.length > maxLen) s = s.substring(0, maxLen).replace(/\s+\S*$/, '')
  return s
}

function truncateDeck(text, maxLen) {
  if (!text || text.length <= maxLen) return text || ''
  return text.substring(0, maxLen).replace(/\s+\S*$/, '') + '\u2026'
}

function truncateDeckClean(text, maxLen) {
  if (!text || text.length <= maxLen) return text || ''
  return text.substring(0, maxLen).replace(/\s+\S*$/, '')
}

function cleanDeckPlanItem(text) {
  let s = cleanDeckText(text)
  s = s.replace(/\[.*?\]\s*/g, '')
  s = s.replace(/^(XO|Streamline|Both|Client|FLAG FOR HUMAN REVIEW)\s*:\s*/i, '').trim()
  return truncateDeckClean(s, 120)
}

function parseDeckWorkflows(md, count) {
  if (!md) return []
  const items = []
  const sections = md.split(/\*\*\d*\.?\s*/)
  for (const section of sections) {
    if (!section.trim()) continue
    const titleEnd = section.indexOf('**')
    if (titleEnd < 0) continue
    const title = section.substring(0, titleEnd).trim()
    if (!title || title.length > 80 || title.includes('\n')) continue
    const body = section.substring(titleEnd + 2).trim()
    let desc = ''
    const wfLine = body.match(/(?:Workflow|Outcome|Solution):\s*(.+)/i)
    if (wfLine) desc = cleanDeckText(wfLine[1])
    else {
      const firstLine = body.split('\n').find(l => l.trim() && !l.trim().startsWith('Problem:'))
      desc = cleanDeckText(firstLine || '')
    }
    items.push({ title: cleanDeckText(title), desc: firstDeckSentence(desc, 120) })
    if (items.length >= count) break
  }
  const generics = [
    { title: 'Document Intelligence', desc: 'Automated extraction and classification of operational documents' },
    { title: 'Compliance Monitoring', desc: 'Continuous scanning against regulatory requirements' },
    { title: 'Decision Support', desc: 'Evidence-based recommendations bounded by domain rules' },
    { title: 'Workflow Automation', desc: 'Protocol-driven task execution with audit trail' },
    { title: 'Knowledge Capture', desc: 'Encoding institutional expertise into reusable protocols' },
    { title: 'Performance Analytics', desc: 'Real-time operational dashboards for stakeholders' },
  ]
  while (items.length < count) items.push(generics[items.length % generics.length])
  return items.slice(0, count)
}

function assembleDeckData(results, client, engagementName) {
  if (!results) return null
  const problems = results.problems || results.problems_identified || []
  const plan = results.plan || results.action_plan || {}
  let planPhases = []
  if (Array.isArray(plan)) planPhases = plan
  else if (typeof plan === 'object') planPhases = Object.entries(plan).map(([phase, actions]) => ({ phase, actions }))

  const clientName = (client && client.company_name) || results.company_name || 'Client'
  const industry = (client && client.industry) || results.client_industry || 'this domain'
  const scope = engagementName || industry
  const scopeCap = scope.charAt(0).toUpperCase() + scope.slice(1)
  const contactName = (client && client.contact_name) || results.client_contact || clientName
  const bottomLine = results.bottom_line || ''
  const streamline = results.streamline_applications || ''
  const shortName = clientName.length > 20 ? clientName.split(/\s+/).slice(0, 2).join(' ') : clientName

  let dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  if (results.analyzed_at) { try { dateStr = new Date(results.analyzed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) } catch(e) {} }

  const highSev = problems.filter(p => (p.severity || '').toLowerCase() === 'high').length
  const medSev = problems.filter(p => (p.severity || '').toLowerCase() === 'medium').length
  const workflows = parseDeckWorkflows(streamline, 6)

  const stats = [
    { num: String(problems.length), label: 'Issues Identified', sub: `${highSev} high severity` },
    { num: highSev > 0 ? 'HIGH' : medSev > 0 ? 'MEDIUM' : 'LOW', label: 'Risk Level', sub: `${highSev} critical, ${medSev} moderate` },
    { num: String(Math.min(6, problems.length, workflows.length)), label: 'XO Workflows', sub: 'Automated via Streamline' },
    { num: '21 days', label: 'Proof of Concept', sub: 'Capture \u2192 Prototype \u2192 Deploy' },
  ]

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  const sorted = [...problems].sort((a, b) => (severityOrder[(a.severity || 'low').toLowerCase()] || 3) - (severityOrder[(b.severity || 'low').toLowerCase()] || 3))
  const challenges = sorted.slice(0, 4).map(p => ({
    title: truncateDeckClean(cleanDeckText(p.title || 'Operational Gap'), 60),
    desc: firstDeckSentence(p.evidence || p.description || p.recommendation || '', 150),
  }))

  const accentCycle = ['BLUE', 'RED', 'GREEN']
  const workflowData = workflows.map((w, i) => ({ title: truncateDeck(w.title, 45), desc: truncateDeck(w.desc, 120), accent: accentCycle[i % 3] }))

  const comparisons = []
  const comparisonCount = Math.min(6, problems.length, workflows.length)
  for (let i = 0; i < comparisonCount; i++) {
    const prob = problems[i]
    const wf = workflows[i]
    if (!prob && !wf) break
    comparisons.push({
      before: truncateDeck(cleanDeckText(prob ? prob.title || 'Manual process with no audit trail' : ''), 120),
      after: truncateDeck(wf && wf.title ? `Streamline + XO automates ${wf.title.toLowerCase()}` : 'Protocol-driven automation with audit trail', 120),
    })
  }

  const phases = []
  const weekTitles = ['Capture & Quick Wins', 'Prototype & Validate', 'Deploy & Decide']
  const defaults = [
    [`Knowledge Abstraction \u2014 extract ${contactName}'s ${scope} expertise`, 'Map current manual workflows', 'Identify quick-win automations', 'Baseline metrics for ROI measurement'],
    [`XO shadows live ${scope} operations \u2014 parallel run alongside manual process`, 'Validate protocol accuracy with domain experts', 'Iterate on constitutional safety rules', 'Stakeholder review of prototype outputs'],
    [`Full ${scope} dashboard deployed to stakeholders`, 'Operator training and handover', 'Performance metrics vs baseline', 'Evidence-based business case for full deployment'],
  ]
  for (let w = 0; w < 3; w++) {
    const pp = planPhases[w] || {}
    let items = []
    if (Array.isArray(pp.actions)) items = pp.actions.slice(0, 4).map(a => cleanDeckPlanItem(typeof a === 'string' ? a : a.action || a.description || a.title || String(a)))
    else if (typeof pp.actions === 'string') items = pp.actions.split(/[;\n]/).filter(s => s.trim()).slice(0, 4).map(s => cleanDeckPlanItem(s))
    while (items.length < 4) items.push(defaults[w][items.length])
    phases.push({ week: `WEEK ${w + 1}`, title: cleanDeckText(pp.phase || weekTitles[w]), items: items.slice(0, 4) })
  }

  const firstActionsArr = planPhases[0]?.actions || []
  const firstActionRaw = Array.isArray(firstActionsArr) ? (typeof firstActionsArr[0] === 'string' ? firstActionsArr[0] : firstActionsArr[0]?.action || firstActionsArr[0]?.description || '') : ''
  const firstAction = truncateDeckClean(cleanDeckText(firstActionRaw), 80)

  return {
    title: engagementName ? `Operational Briefing:\nScaling ${clientName} \u2014 ${engagementName}` : `Operational Briefing:\nScaling ${clientName}`,
    contactLine: `Prepared for ${contactName}  |  ${dateStr}`,
    slideTitle: `Where ${shortName} Stands Today`,
    oodaTitle: shortName,
    stats,
    challengeTitle: `The ${scopeCap} Challenge`,
    challenges,
    problemCallout: problems.length > 0 ? `The cost of these ${problems.length} ${scope} gaps compounds as ${clientName} scales \u2014 each manual workaround adds latency, risk, and key-person dependency.` : `Operational ${scope} gaps compound as ${clientName} scales.`,
    oodaPhases: [
      { phase: 'OBSERVE', desc: truncateDeck(`24/7 sentinel scanning ${clientName}'s ${scope} data sources. Data gated by risk classification.`, 150) },
      { phase: 'ORIENT', desc: truncateDeck(`Mandatory decomposition \u2014 contextualises against ${scope} domain rules. Risks explicitly enumerated.`, 150) },
      { phase: 'DECIDE', desc: truncateDeck(`Executive framing \u2014 ranks actions, applies ${clientName}'s ${scope} governance rules. Post-governance validation.`, 150) },
      { phase: 'ACT', desc: truncateDeck(`Bounded execution via Streamline \u2014 ${contactName}'s ${scope} team authorises; system executes. Full audit trail.`, 150) },
    ],
    maturityStart: `${shortName} starts at L1. You pull us forward as confidence builds.`,
    workflowTitle: engagementName ? `${engagementName} Workflows That Encode Institutional Knowledge` : 'Workflows That Encode Institutional Knowledge',
    workflows: workflowData,
    beforeAfterTitle: engagementName ? `${engagementName}: From System of Record to System of Action` : 'From System of Record to System of Action',
    comparisons: comparisons.slice(0, 6),
    impactLine: `Estimated ${problems.length > 3 ? '60' : '40'}% reduction in manual ${scope} operations as ${clientName} scales toward full deployment`,
    pocTitle: engagementName ? `21-Day ${engagementName} Proof of Concept` : '21-Day Proof of Concept',
    phases,
    nextSteps: [
      { num: '1', text: firstAction || `Share ${scope} operational data and system access for knowledge extraction` },
      { num: '2', text: `Week 1 quick win \u2014 first ${scope} workflow live within 7 days` },
      { num: '3', text: `21-day pilot \u2014 full ${scope} XO deployment to ${contactName}'s team` },
    ],
    successMetric: bottomLine ? truncateDeck(firstDeckSentence(bottomLine, 100), 100) + ' Institutional knowledge encoded into protocol, not people.' : 'Key-person dependency resolved. Institutional knowledge encoded into protocol, not people.',
    constitutionalSafetyTitle: `Constitutional Safety \u2014 Why This Matters for ${shortName}'s ${scopeCap} Operations`,
    constitutionalSafetyNote: `In ${scope}, a single unchecked decision can cascade into compliance failures, financial exposure, and reputational damage. XO's Two-Brain architecture (Actor + Critic), designed by Dr. Mabrouka Abuhmida, ensures every output is bounded by ${clientName}'s own domain rules \u2014 not advisory guidelines, but hard constitutional constraints with full audit trails.`,
  }
}

function assembleBrief(results, client) {
  if (!results || !results.summary) return null
  const problems = results.problems || []
  const primary = problems[0] || {}
  const industry = (client && client.industry) || 'this domain'
  const companyName = (client && client.company_name) || results.company_name || 'the client'
  const contactName = (client && client.contact_name) || results.client_contact || ''
  const description = (client && client.description) || ''
  const plan = results.plan || results.action_plan || {}

  // Build plan phases array from either format
  let planPhases = []
  if (Array.isArray(plan)) {
    planPhases = plan
  } else if (typeof plan === 'object') {
    planPhases = Object.entries(plan).map(([phase, actions]) => ({ phase, actions }))
  }

  return {
    cover: {
      client_name: companyName,
      client_descriptor: description || industry,
      headline: primary.title ? `XO Deployment: ${primary.title}` : `XO Deployment for ${companyName}`,
      value_proposition: results.bottom_line ? results.bottom_line.split('.').slice(0, 2).join('.') + '.' : '',
      client_contact: contactName,
      meeting_date: 'TBD',
    },
    executive_summary: results.summary || results.executive_summary || '',
    key_metrics: [
      { value: String(problems.length), label: 'Critical Issues Identified', sublabel: `${problems.filter(p => p.severity === 'high').length} high severity` },
      ...(problems.slice(0, 2).map(p => ({
        value: p.severity === 'high' ? 'HIGH' : p.severity === 'medium' ? 'MED' : 'LOW',
        label: p.title.length > 40 ? p.title.substring(0, 37) + '...' : p.title,
        sublabel: p.severity + ' priority'
      }))),
    ],
    sections: [
      {
        number: '01',
        title: `CLIENT PROFILE: ${companyName}`,
        content: (results.summary || '') + (description ? `\n\n**Industry:** ${industry}\n\n${description}` : ''),
        callout: { label: `THE ${industry.toUpperCase()} CONTEXT`, content: primary.evidence || '' }
      },
      {
        number: '02',
        title: 'THE OPERATIONAL CRISIS',
        content: problems.map(p => `**${p.title}** (${p.severity} severity)\n${p.evidence || ''}\n\n**Recommendation:** ${p.recommendation || ''}`).join('\n\n---\n\n'),
      },
      {
        number: '03',
        title: 'WHY STANDARD AI CANNOT BE USED HERE',
        content: `Generic AI tools like ChatGPT or off-the-shelf automation platforms cannot safely operate in ${industry} because they lack domain-specific guardrails. In ${companyName}'s environment, a single error in ${primary.title ? primary.title.toLowerCase() : 'operational processes'} could result in ${primary.evidence ? primary.evidence.split('.')[0].toLowerCase() : 'significant compliance and operational failures'}.\n\nStandard AI has no concept of ${industry} compliance hierarchies, cannot cross-reference domain-specific standards and regulations, and provides no audit trail for regulatory accountability. The XO platform's Constitutional Safety layer ensures that every AI-generated output is bounded by domain rules that the operator defines and controls.`,
      },
      {
        number: '04',
        title: 'THE XO DEPLOYMENT: ARCHITECTURE & OODA WORKFLOW',
        content: (results.architecture_diagram ? '```\n' + results.architecture_diagram + '\n```\n\n' : '') +
          `The XO deployment for ${companyName} operates on a continuous **Observe-Orient-Decide-Act** loop, processing ${industry} data through domain-specific rules before any output reaches the operator.\n\n` +
          `**Observe:** XO ingests documents, data feeds, and operational inputs from ${companyName}'s systems.\n` +
          `**Orient:** The DX Cartridge contextualises each input against ${industry} rules, standards, and historical patterns.\n` +
          `**Decide:** XO generates recommendations bounded by Constitutional Safety rules — flagging items that require human judgment.\n` +
          `**Act:** Approved outputs are delivered through Streamline workflows, with full audit logging.`,
      },
      {
        number: '05',
        title: 'CONSTITUTIONAL SAFETY',
        content: `XO enforces a Constitutional Layer — a set of immutable domain rules that the AI cannot override. For ${companyName}, this means:\n\n` +
          `- **Compliance Validation:** Every output is validated against ${industry} standards and regulations before delivery\n` +
          `- **Human Authority:** The operator retains final authority on all decisions flagged as requiring human judgment\n` +
          `- **Audit Trail:** All AI actions are logged with full provenance for regulatory audit\n` +
          `- **Domain Boundaries:** Boundaries are encoded as rules, not suggestions — the system cannot generate outputs that violate them`,
      },
      {
        number: '06',
        title: 'INTELLISTACK STREAMLINE APPLICATIONS',
        content: results.streamline_applications || results.Streamline_applications || '',
      },
      {
        number: '07',
        title: 'PROOF OF CONCEPT & NEXT STEPS',
        content: planPhases.map(p => `**${p.phase}**\n${(p.actions || []).map(a => a.replace(/^\d+\.\s*/, '')).map((a, i) => `${i + 1}. ${a}`).join('\n')}`).join('\n\n'),
      },
    ],
    ooda_phases: [
      { name: 'OBSERVE', tagline: `Ingests ${companyName}'s operational data`, bullets: ['Document upload and extraction', 'Data feed integration', 'Historical pattern capture'] },
      { name: 'ORIENT', tagline: `Contextualises against ${industry} rules`, bullets: ['Domain rule matching', 'Compliance cross-reference', 'Risk classification'] },
      { name: 'DECIDE', tagline: 'Generates bounded recommendations', bullets: ['AI analysis within safety constraints', 'Human-judgment flagging', 'Confidence scoring'] },
      { name: 'ACT', tagline: 'Delivers through Streamline workflows', bullets: ['Automated report generation', 'Notification and escalation', 'Full audit logging'] },
    ],
    poc_timeline: [
      { step: '1', timeline: 'Week 1', action: (planPhases[0] ? (planPhases[0].actions || [])[0] || 'Configure DX Cartridge with domain rules' : 'Configure DX Cartridge with domain rules').replace(/^\d+\.\s*/, '') },
      { step: '2', timeline: 'Week 1-2', action: (planPhases[0] ? (planPhases[0].actions || [])[1] || 'Ingest sample data and validate extraction' : 'Ingest sample data and validate extraction').replace(/^\d+\.\s*/, '') },
      { step: '3', timeline: 'Week 2', action: (planPhases[1] ? (planPhases[1].actions || [])[0] || 'Run analysis against live data' : 'Run analysis against live data').replace(/^\d+\.\s*/, '') },
      { step: '4', timeline: 'Week 3', action: (planPhases[2] ? (planPhases[2].actions || [])[0] || 'Review results and make deploy/iterate decision' : 'Review results and make deploy/iterate decision').replace(/^\d+\.\s*/, '') },
    ],
    success_metric: primary.title
      ? `The pilot is successful when ${primary.title.toLowerCase()} is resolved without manual intervention in the current workflow.`
      : `The pilot is successful when the primary operational bottleneck is resolved through automated XO processing.`,
  }
}

function ResultsScreen({ setShowModal, clientId, isAdmin,systemButtons,theme,preferredModel, activeEngagement, setActiveEngagement, onNavigate }) {
  // Check if a button should render on a page, respecting hidden flag and showOn config.
  // If no matching systemButtons entry exists (legacy/hardcoded), returns true (preserve existing behavior).
  const shouldRenderButton = (label, page) => {
    const btn = (systemButtons || []).find(b => b.label === label || b.name === label)
    if (!btn) return true // no config entry = legacy, render as before
    if (btn.hidden) return false
    const showOn = btn.showOn || btn.show_on
    if (!showOn || !Array.isArray(showOn)) return true // undefined showOn = legacy, render as before
    return showOn.includes(page)
  }
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedTables, setExpandedTables] = useState({})
  const [expandedProblems, setExpandedProblems] = useState({})
  const [expandedSubBlocks, setExpandedSubBlocks] = useState({})
  const [lastExpandedSection, setLastExpandedSection] = useState(null)
  const [streamlineSending, setStreamlineSending] = useState(false)
  const [streamlineStatus, setStreamlineStatus] = useState(null) // null | 'sent' | 'error'
  const [buildingWorkflow, setBuildingWorkflow] = useState({}) // { [appIndex]: 'building' | 'done' | 'error' }
  const [buildResults, setBuildResults] = useState({}) // { [appIndex]: { project_id, needs_ui_config } }
  const [protoDownloading, setProtoDownloading] = useState(false)
  const [briefDownloadLoading, setBriefDownloadLoading] = useState(false)
  const [deckDownloadLoading, setDeckDownloadLoading] = useState(false)
  const [briefApproveLoading, setBriefApproveLoading] = useState(false)
  const [deckApproveLoading, setDeckApproveLoading] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(null) // null | 'brief' | 'deck'
  const [reviewText, setReviewText] = useState('')
  const [reviewSaving, setReviewSaving] = useState(false)
  const [reviewStatus, setReviewStatus] = useState(null) // null | 'saved' | 'approved'
  const [currentClient,setCurrentClient]=useState(null)
  const [expandedResult,setExpandedResult]= useState({id:"executiveSummary",name:"Executive Summary",shortDescription:"Here is our understanding of your business",severity: 'high'});
  const [componentMappingExpanded, setComponentMappingExpanded] = useState(false);
  const [pocScope, setPocScope] = useState(null) // null | { problems: [], new_components: [], scoped_at, scoped_by }
  const [showScopeModal, setShowScopeModal] = useState(false)
  const [scopeProblems, setScopeProblems] = useState(new Set())
  const [scopeComponents, setScopeComponents] = useState(new Set())
  const [scopeSaving, setScopeSaving] = useState(false)
  const [scopeExpanded, setScopeExpanded] = useState(false)
  const [formattedResults,setFormattedResults] = useState([
    {id:"executiveSummary",icon:"TrendingUp",name:"Executive Summary",shortDescription:"Here is our understanding of your business",severity: 'high'},
    {id:"problemsIdentified",icon:"AlertTriangle",name:"Problems Identified",shortDescription:"Key pain points and gaps surfaced by the analysis",severity: 'high'},
    {id:"solutions",icon:"Zap",name:"Solutions",shortDescription:"",severity: 'high'},
    {id:"rapidDeployment",icon:"Package",name:"Rapid Deployment",shortDescription:"Timeline and action plan",severity: 'high'},
    {id:"technicalSection",icon:"Globe",name:"Technical Section",shortDescription:"",severity: 'high'},
    {id:"deploymentBrief",icon:"FileText",name:"Deployment Brief",shortDescription:"CLIENT-READY XO DEPLOYMENT DOCUMENT",severity: 'high'},
    {id:"growthDeck",icon:"Package",name:"Growth Deck",shortDescription:"CLIENT-READY XO GROWTH PRESENTATION",severity: 'high'}
  ]);
  const [expandedSummary,setExpandedSummary]= useState(null);
  const [formattedSummary,setFormattedSummary] = useState([
    {id:"opportunitiesList",icon:"Star",name:"Opportunities List",shortDescription:"",severity: 'high'},
    {id:"bottomLine",icon:"Zap",name:"Bottom Line",shortDescription:"",severity: 'high'}
  ]);

  const fetchClient = async (clientId)=>{
    if(clientId) {
      try {
        const res = await fetch(`${API_BASE}/clients?client_id=${clientId}`, {headers: getAuthHeaders()})
        if (res.ok) {
          const data = await res.json();
         setCurrentClient(data);
          //console.log(data);
        }
      } catch (err) {
        console.error('Failed to fetch client:', err)
      }
    }
  }

  // Sync POC scope from active engagement (or null if no engagement)
  useEffect(() => {
    if (activeEngagement?.poc_scope) setPocScope(activeEngagement.poc_scope)
    else setPocScope(null)
    setScopeExpanded(false)
  }, [activeEngagement?.id, activeEngagement?.poc_scope])

  const openScopeModal = () => {
    const problems = displayResults?.problems || []
    const newComps = displayResults?.component_mapping?.new_components || []
    if (pocScope) {
      const savedProblems = new Set(pocScope.problems || [])
      const savedComps = new Set(pocScope.new_components || [])
      setScopeProblems(new Set(problems.map(p => slugifyProblem(p.title)).filter(id => savedProblems.has(id))))
      setScopeComponents(new Set(newComps.map(n => n.proposed_name).filter(n => savedComps.has(n))))
    } else {
      setScopeProblems(new Set(problems.map(p => slugifyProblem(p.title))))
      setScopeComponents(new Set(newComps.map(n => n.proposed_name)))
    }
    setShowScopeModal(true)
  }

  const savePocScope = async () => {
    if (!activeEngagement?.id) return
    setScopeSaving(true)
    try {
      const res = await fetch(`${API_BASE}/clients?action=scope`, {
        method: 'PUT', headers: getAuthHeaders(),
        body: JSON.stringify({ engagement_id: activeEngagement.id, problems: [...scopeProblems], new_components: [...scopeComponents] })
      })
      if (res.ok) {
        const data = await res.json()
        setPocScope(data.poc_scope)
        if (activeEngagement) setActiveEngagement(prev => ({ ...prev, scope_review_needed: false }))
        setShowScopeModal(false)
      }
    } catch (err) { console.error('Failed to save scope:', err) }
    setScopeSaving(false)
  }

  const isDraft = activeEngagement ? !activeEngagement.approved_at : !currentClient?.approved_at

  const handleSaveCorrections = async () => {
    if (!reviewText.trim() || !clientId) return
    setReviewSaving(true)
    try {
      const label = showReviewModal === 'deck' ? 'Factual Corrections - Deck' : 'Factual Corrections - Brief'
      const fileName = `${label.replace(/\s+/g, '_')}_${Date.now()}.txt`
      const blob = new Blob([reviewText], { type: 'text/plain' })
      const file = new globalThis.File([blob], fileName, { type: 'text/plain' })
      const res = await fetch(`${API_BASE}/upload`, {
        method: 'POST', headers: getAuthHeaders(),
        body: JSON.stringify({ client_id: clientId, files: [{ name: file.name, type: file.type, size: file.size }] })
      })
      if (!res.ok) throw new Error('Upload request failed')
      const data = await res.json()
      const uploadUrl = (data.upload_urls || [])[0]
      if (!uploadUrl) throw new Error('No upload URL returned')
      await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': 'text/plain' } })
      setReviewText('')
      setReviewStatus('saved')
      setTimeout(() => { setReviewStatus(null); setShowReviewModal(null) }, 2000)
    } catch (err) {
      alert('Failed to save corrections: ' + err.message)
    }
    setReviewSaving(false)
  }

  const handleApprove = async (section) => {
    if (!clientId || !currentClient) return
    const setLoading = section === 'deck' ? setDeckApproveLoading : setBriefApproveLoading
    setLoading(true)
    try {
      if (activeEngagement) {
        await fetch(`${API_BASE}/engagements`, {
          method: 'PUT', headers: getAuthHeaders(),
          body: JSON.stringify({ engagement_id: activeEngagement.id, approved: true })
        })
        setActiveEngagement(prev => prev ? { ...prev, approved_at: new Date().toISOString() } : prev)
      } else {
        await fetch(`${API_BASE}/clients`, {
          method: 'PUT', headers: getAuthHeaders(),
          body: JSON.stringify({ client_id: clientId, company_name: currentClient.company_name, approved: true })
        })
      }
      await fetchClient(clientId)
      setReviewStatus('approved')
      setShowReviewModal(null)
      setTimeout(() => setReviewStatus(null), 3000)
    } catch (err) {
      alert('Approval failed: ' + err.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (lastExpandedSection) {
      const timer = setTimeout(() => {
        document.querySelector(`[data-section="${lastExpandedSection}"]`)?.scrollIntoView({ behavior: 'instant', block: 'start' });
        setLastExpandedSection(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [lastExpandedSection])

  const toggleResult = (item) => {
    if(expandedResult === null || expandedResult !== item) {
      setExpandedResult(item);
      if (item.id === 'solutions') setExpandedSubBlocks({});
      setLastExpandedSection(item.id);
    } else setExpandedResult(null);
  }

  const toggleSummary = (item) => {
    if(item===null || item!==expandedSummary) { setExpandedSummary(item); setLastExpandedSection(item.id); }
    else setExpandedSummary(null);
  }

  useEffect(() => {
    if (clientId) {
      fetchResults()
      fetchClient(clientId);
    }
  }, [clientId])

  const fetchResults = async () => {
    try {
      setLoading(true)
      const engParam = activeEngagement?.id ? `?engagement_id=${activeEngagement.id}` : ''
      const response = await fetch(`${API_BASE}/results/${clientId}${engParam}`, {
        headers: getAuthHeaders()
      })
      if (!response.ok) throw new Error('Failed to fetch results')
      const data = await response.json()
      setResults(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const sendToStreamline = async () => {
    setStreamlineSending(true)
    setStreamlineStatus(null)
    try {
      const response = await fetch(`${API_BASE}/send-to-streamline`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ client_id: clientId })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to send')
      setStreamlineStatus('sent')
      setTimeout(() => setStreamlineStatus(null), 4000)
    } catch (err) {
      setStreamlineStatus('error')
      setTimeout(() => setStreamlineStatus(null), 4000)
    } finally {
      setStreamlineSending(false)
    }
  }

  const issueReport = async () => {
    // Report implementation to go here
  }

  const toggleTable = (tableName) => {
    setExpandedTables(prev => ({ ...prev, [tableName]: !prev[tableName] }))
  }

  const toggleProblem = (index) => {
    const expanding = !expandedProblems[index];
    setExpandedProblems(prev => ({ ...prev, [index]: !prev[index] }))
    if (expanding) setLastExpandedSection('problem-' + index);
  }

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return '#dc2626'
      case 'medium': return '#f59e0b'
      case 'low': return '#3b82f6'
      default: return '#6b7280'
    }
  }

  const getSeverityBg = (severity) => {
    switch (severity) {
      case 'high': return 'rgba(220, 38, 38, 0.1)'
      case 'medium': return 'rgba(245, 158, 11, 0.1)'
      case 'low': return 'rgba(59, 130, 246, 0.1)'
      default: return 'rgba(107, 116, 128, 0.1)'
    }
  }

  // Mock data for demonstration (remove when backend is ready)
  const mockResults = {
    status: 'complete',
    summary: 'This analysis reveals a mid-sized waste management company operating across three counties with approximately 2,500 commercial clients. The business demonstrates strong operational capabilities but faces challenges in route optimization, customer billing accuracy, and equipment maintenance tracking. Current revenue is estimated at $12-15M annually with modest EBITDA margins of 18-22%.',
    problems: [
      {
        title: 'Route Optimization Inefficiency',
        severity: 'high',
        evidence: 'Manual route planning leads to 15-20% excess fuel costs and driver overtime. Analysis of uploaded CSV data shows overlapping routes and suboptimal stop sequencing.',
        recommendation: 'Implement route optimization software. Expected ROI: $180K annually in fuel and labor savings.'
      },
      {
        title: 'Billing Reconciliation Errors',
        severity: 'high',
        evidence: 'Excel spreadsheets show 8-12% monthly discrepancies between service completion and invoicing. Lost revenue estimated at $60K-$90K annually.',
        recommendation: 'Integrate GPS tracking with automated billing system. Reduce reconciliation errors to <2%.'
      },
      {
        title: 'Equipment Maintenance Tracking',
        severity: 'medium',
        evidence: 'Maintenance records are paper-based and incomplete. Fleet downtime averages 12% vs. industry benchmark of 6-8%.',
        recommendation: 'Deploy fleet management system with predictive maintenance capabilities.'
      }
    ],
    schema: {
      tables: [
        {
          name: 'customers',
          purpose: 'Commercial client master data',
          columns: [
            { name: 'customer_id', type: 'UUID', description: 'Unique customer identifier' },
            { name: 'company_name', type: 'VARCHAR(255)', description: 'Business legal name' },
            { name: 'service_address', type: 'VARCHAR(500)', description: 'Primary pickup location' },
            { name: 'service_frequency', type: 'ENUM', description: 'Weekly, bi-weekly, monthly' },
            { name: 'container_type', type: 'VARCHAR(100)', description: 'Dumpster size and type' },
            { name: 'monthly_rate', type: 'DECIMAL(10,2)', description: 'Contracted service fee' }
          ],
          relationships: ['routes', 'invoices']
        },
        {
          name: 'routes',
          purpose: 'Daily service route assignments',
          columns: [
            { name: 'route_id', type: 'UUID', description: 'Unique route identifier' },
            { name: 'route_date', type: 'DATE', description: 'Scheduled service date' },
            { name: 'driver_id', type: 'UUID', description: 'Assigned driver' },
            { name: 'truck_id', type: 'UUID', description: 'Assigned vehicle' },
            { name: 'stop_sequence', type: 'INTEGER', description: 'Optimized stop order' },
            { name: 'customer_id', type: 'UUID', description: 'Foreign key to customers' }
          ],
          relationships: ['customers', 'trucks']
        },
        {
          name: 'trucks',
          purpose: 'Fleet vehicle master data and maintenance',
          columns: [
            { name: 'truck_id', type: 'UUID', description: 'Unique vehicle identifier' },
            { name: 'truck_number', type: 'VARCHAR(50)', description: 'Fleet number (e.g., T-042)' },
            { name: 'make_model', type: 'VARCHAR(100)', description: 'Vehicle manufacturer and model' },
            { name: 'year', type: 'INTEGER', description: 'Model year' },
            { name: 'mileage', type: 'INTEGER', description: 'Current odometer reading' },
            { name: 'last_maintenance', type: 'DATE', description: 'Most recent service date' }
          ],
          relationships: ['routes', 'maintenance_log']
        }
      ]
    },
    plan: [
      {
        phase: '30-day',
        actions: [
          'Audit existing customer database and geocode all service addresses',
          'Deploy GPS tracking units on all fleet vehicles',
          'Conduct time-motion study on current route performance',
          'Select route optimization vendor and begin integration planning'
        ]
      },
      {
        phase: '60-day',
        actions: [
          'Launch automated billing reconciliation with GPS validation',
          'Pilot route optimization on 2-3 high-volume routes',
          'Implement digital maintenance logging for fleet',
          'Train drivers on new mobile app for service confirmation'
        ]
      },
      {
        phase: '90-day',
        actions: [
          'Roll out route optimization across full fleet',
          'Measure fuel savings and driver overtime reduction',
          'Complete migration to automated billing for all customers',
          'Establish KPI dashboard for operations monitoring'
        ]
      }
    ],
    sources: [
      { type: 'client_data', reference: 'customer_list.csv (2,487 records)' },
      { type: 'client_data', reference: 'billing_export.xlsx (Q4 2025 invoices)' },
      { type: 'web_enrichment', reference: 'Company website analysis' },
      { type: 'web_enrichment', reference: 'Industry benchmarking data (Waste360, NWRA)' },
      { type: 'ai_analysis', reference: 'Claude Sonnet 4.5 - GPT analysis engine' }
    ]
  }

  const displayResults = results || mockResults

  // Split summary into bullet points — preserve model's intended groupings
  let displayPhrases = [];
  const rawSummary = displayResults.summary || '';
  if (rawSummary.includes('\n')) {
    // Model returned structured bullets — split on newlines, keep multi-sentence bullets together
    displayPhrases = rawSummary.split(/\n{1,2}/).map(s => s.trim()).filter(s => s.length > 0)
  } else {
    // Legacy: no newlines — fall back to sentence segmenter
    const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    for (const segment of segmenter.segment(rawSummary)) {
      if (segment.segment.trim()) displayPhrases.push(segment.segment)
    }
  }

  if (loading) {
    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <FileText size={20} className="icon-red" />
            <h2>Analysis Results</h2>
          </div>
        </div>
        <div className="empty-state">
          <Loader2 size={48} style={{ color: '#dc2626', animation: 'spin 1s linear infinite' }} />
          <p>Loading results...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <FileText size={20} className="icon-red" />
            <h2>Analysis Results</h2>
          </div>
        </div>
        <div style={{ padding: '1.25rem' }}>
          <div style={{
            background: 'rgba(220, 38, 38, 0.05)',
            border: '1px solid rgba(220, 38, 38, 0.2)',
            borderRadius: '12px',
            padding: '1.5rem',
            textAlign: 'center'
          }}>
            <AlertCircle size={48} style={{ color: '#dc2626', margin: '0 auto 1rem' }} />
            <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem', color: '#dc2626' }}>
              Failed to Load Results
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {error}
            </p>
            <button onClick={fetchResults} className="action-btn red">
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '1rem', padding: '0 2rem' }}>
      <ActiveEngagementBanner activeEngagement={activeEngagement} onNavigate={onNavigate} />
      {/* Header */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <FileText size={20} className="icon-red" />
            <h2>Analysis Results</h2>
            {displayResults?.problems?.length > 0 ? (
              <span className="badge-count green">Complete</span>
            ) : displayResults?.status === 'processing' ? (
              <span className="badge-count" style={{ background: 'rgba(245,158,11,0.15)', color: '#d97706' }}>Processing</span>
            ) : null}
            <span style={{
              marginLeft: 'auto',
              fontSize: '0.7rem',
              fontWeight: 600,
              color: preferredModel.includes('opus') ? '#a855f7' : '#3b82f6',
              background: preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.1)' : 'rgba(59, 130, 246, 0.1)',
              padding: '3px 10px',
              borderRadius: '999px',
              border: `1px solid ${preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
            }}>
            Intellagentic Engine
          </span>
            <span style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              color: preferredModel.includes('opus') ? '#a855f7' : '#3b82f6',
              background: preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.1)' : 'rgba(59, 130, 246, 0.1)',
              padding: '2px 8px',
              borderRadius: '999px',
              border: `1px solid ${preferredModel.includes('opus') ? 'rgba(168, 85, 247, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
            }}>
                      {MODEL_LABELS[preferredModel] || preferredModel}
                    </span>
          </div>
          {isAdmin && displayResults?.problems?.length > 0 && displayResults.summary && displayResults.summary !== 'Analysis failed' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {streamlineStatus === 'sent' && (
                <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 500 }}>Sent to Streamline</span>
              )}
              {streamlineStatus === 'error' && (
                <span style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 500 }}>Failed to send</span>
              )}
              {/*<button
                onClick={async () => {
                  setProtoDownloading(true)
                  try {
                    const res = await fetch(`${API_BASE}/rapid-prototype/${clientId}${activeEngagement?.id ? `?engagement_id=${activeEngagement.id}` : ''}`, { headers: getAuthHeaders() })
                    if (!res.ok) throw new Error('Failed to generate spec')
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'PROTOTYPE-SPEC.md'
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    URL.revokeObjectURL(url)
                  } catch (e) {
                    console.error('Prototype spec download failed:', e)
                  } finally {
                    setProtoDownloading(false)
                  }
                }}
                disabled={protoDownloading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px',
                  background: protoDownloading ? '#94a3b8' : '#000000',
                  color: 'white', border: 'none', borderRadius: 8,
                  cursor: protoDownloading ? 'not-allowed' : 'pointer',
                  fontSize: '0.75rem', fontWeight: 600,
                  transition: 'all .2s'
                }}
              >
                {protoDownloading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
                {protoDownloading ? 'Generating...' : 'Download Prototype Spec (.md)'}
              </button>
              <button onClick={openScopeModal} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', background: '#0F969C', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>
                <Settings size={14} /> Scope POC
              </button>
              <button
                onClick={sendToStreamline}
                disabled={streamlineSending}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px',
                  background: streamlineSending ? '#94a3b8' : '#3b82f6',
                  color: 'white', border: 'none', borderRadius: 8,
                  cursor: streamlineSending ? 'not-allowed' : 'pointer',
                  fontSize: '0.75rem', fontWeight: 600,
                  transition: 'all .2s'
                }}
              >
                {streamlineSending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                {streamlineSending ? 'Sending...' : 'Send to Streamline'}
              </button>*/}
              {/*<button
                  onClick={issueReport}
                  disabled={streamlineSending}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px',
                    background: streamlineSending ? '#94a3b8' : '#3b82f6',
                    color: 'white', border: 'none', borderRadius: 8,
                    cursor: streamlineSending ? 'not-allowed' : 'pointer',
                    fontSize: '0.75rem', fontWeight: 600,
                    transition: 'all .2s'
                  }}
              >
                {streamlineSending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                {streamlineSending ? 'Sending...' : 'Issue Report'}
              </button>*/}
              {systemButtons.filter((d)=>{return (d.label==="Issue Report") && !d.hidden && (() => { const s = d.showOn || d.show_on; return !s || !Array.isArray(s) || s.includes('results') })()}).map((btn,idx)=>{
                const IconComp = ICON_MAP[btn.icon] || Zap
                return <button
                    key={"btn"+idx}
                    onClick={()=>{
                      //let btnURL = btn.url+"?client='"+`${encodeURIComponent(JSON.stringify(currentClient))}`+"'&results='"+`${encodeURIComponent(JSON.stringify(displayResults))}`+"'"
                      let btnURL=btn.url;
                      if(displayResults.status!=="complete") return;
                      // Opportunities
                      let displayOpportunities= [];
                      let opps = displayResults.client_summary.split("\n\n- **");
                      for(let op of opps){
                        if(op.indexOf(":** ")>=0){
                          let opSplit = op.split(":** ");
                          let title = opSplit[0];
                          let description = opSplit[1];
                          let dOpportunity = {title: title,description:description};
                          displayOpportunities.push(dOpportunity);
                        }
                      }

                      // Streamline Applications
                      let displayStreamlineApplications = [];
                      let sapps = displayResults.streamline_applications.split("\n\n");
                      for(let sapp of sapps){
                        if(sapp.trim().indexOf(". ")>=0){
                          let sappComps = sapp.split("\n");
                          if(sappComps.length>3) {
                            let titleSplit = sappComps[0].replaceAll("\*", "").split(". ");
                            let rank = titleSplit[0];
                            let title = titleSplit[1];
                            let problem = sappComps[1].replace("Problem: ", "");
                            let workflow = sappComps[2].replace("Workflow: ", "").split(" → ");
                            let integrations = sappComps[3].replace("Integrations: ", "");
                            let outcome = sappComps[4].replace("Outcome: ", "");
                            let sappObj = {
                              rank: rank,
                              title: title,
                              problem: problem,
                              workflow: workflow,
                              integrations: integrations,
                              outcome: outcome
                            };
                            displayStreamlineApplications.push(sappObj);
                          }
                        }
                      }
                      // Phases
                      let displayPhases=[];
                      for(let dp of displayResults.plan){
                        let label = dp.phase;
                        let dpSteps = [];
                        let steps = 1;
                        for(let dpa of dp.actions){
                          let owner = "Both";
                          if(dpa.indexOf("FLAG FOR HUMAN REVIEW")>=0) owner = "Client";
                          if(dpa.indexOf("[Streamline ")>=0) owner = "Streamline";
                          if(dpa.indexOf("[XO ")>=0) owner = "XO";
                          let description = dpa.replace("\[Streamline Setup\] ","")
                              .replace("\[XO Setup\] ","")
                              .replace("\[BOTH\] ","")
                              .replace("FLAG FOR HUMAN REVIEW: ","");

                          let dpStep = {step:steps,owner:owner,description:description}
                          dpSteps.push(dpStep);
                          steps = steps+1;
                        }
                        let dpPhase = {label:label,steps:dpSteps}
                        displayPhases.push(dpPhase);
                      }
                      // Data Sources
                      let displayDataSources=[];
                      for(let ds of displayResults.analyzed_files){
                        let dsource = displayResults.sources.filter((d)=>{return d.reference.indexOf(ds)>=0});
                        if(dsource.length>0){
                          let filename = ds;
                          let summary = dsource[0].reference.replace(ds+ " — ","");
                          let sourceObj = {filename:filename,summary:summary}
                          displayDataSources.push(sourceObj);
                        }
                      }
                      let data = {event:"xo_capture.analysis_complete",
                          timestamp:displayResults.analyzed_at,
                          client_id:currentClient.client_id,
                          status:displayResults.status,
                        executive_summary:{bullets:displayPhrases},
                        opportunities:displayOpportunities,
                        bottom_line:displayResults.bottom_line,
                        problems:displayResults.problems,
                        streamline_applications:displayStreamlineApplications,
                        rapid_deployment:{phases:displayPhases},
                        data_sources:displayDataSources
                      };
                      let payload ={client_id:currentClient.client_id,analysis:JSON.stringify(data)};
                      if (btn.url && btn.url !== '#') io.open('POST', btnURL, payload, '_blank')
                      else return;
                    }}
                    disabled={streamlineSending || displayResults.status!=="complete"}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 14px',
                      background: btn.color,
                      color: 'white', border: 'none', borderRadius: 8,
                      cursor: streamlineSending ? 'not-allowed' : 'pointer',
                      fontSize: '0.75rem', fontWeight: 600,
                      transition: 'all .2s'
                    }}
                >
                  {streamlineSending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <IconComp size={14} />}
                  {streamlineSending ? 'Sending...' : btn.label}
                </button>
              })}
            </div>
          )}
        </div>
      </div>


      {/* POC Scope status + warning — render when analysis has data, regardless of status field */}
      {isAdmin && displayResults?.problems?.length > 0 && (
        <div style={{ padding: '0.25rem 0 0.5rem 0', borderTop: '1px solid var(--border-color, #e5e7eb)', marginTop: '0.25rem' }}>
          {pocScope ? (() => {
            const scopedProblems = (displayResults.problems || []).filter(p => (pocScope.problems || []).includes(slugifyProblem(p.title)))
            const scopedComps = (displayResults.component_mapping?.new_components || []).filter(n => (pocScope.new_components || []).includes(n.proposed_name))
            const needsReview = activeEngagement?.scope_review_needed
            return <div>
              {needsReview && (
                <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, color: '#f59e0b' }} />
                  Problems changed after re-enrichment. Review scope.
                  <button onClick={openScopeModal} style={{ background: 'none', border: 'none', color: '#0F969C', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', padding: 0, textDecoration: 'underline' }}>Review scope</button>
                </div>
              )}
              <div onClick={openScopeModal} style={{ cursor: 'pointer', fontSize: '0.75rem', color: '#6b7280' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: '#0F969C' }}>Scope:</span>
                <span>{scopedProblems.length} of {(displayResults.problems || []).length} problems, {scopedComps.length} of {(displayResults.component_mapping?.new_components || []).length} new components</span>
                <span style={{ color: '#9ca3af' }}>·</span>
                <span>Scoped by {(pocScope.scoped_by || '').split('@')[0]}</span>
                {pocScope.scoped_at && <span style={{ color: '#9ca3af' }}>· {new Date(pocScope.scoped_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
              </div>
              <div style={{ marginTop: '0.2rem', paddingLeft: '3rem', fontSize: '0.7rem', color: '#6b7280' }}>
                {scopedProblems.map((p, i) => <span key={i}>{i > 0 ? ', ' : ''}{p.title?.replace(/^Priority\s+\w+\([iv]+\)\s*:\s*/i, '')}</span>)}
                {scopedComps.map((n, i) => <span key={'c'+i} style={{ color: '#0F969C' }}>{(scopedProblems.length > 0 || i > 0) ? ', ' : ''}{n.proposed_name}</span>)}
              </div>
              </div>
            </div>
          })() : (
            <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              Scope not set — download will include all enriched problems.
              <button onClick={openScopeModal} style={{ background: 'none', border: 'none', color: '#0F969C', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', padding: 0, textDecoration: 'underline' }}>Set scope</button>
            </div>
          )}
        </div>
      )}

      {/* Concertina sections */}
      <div style={{ padding: '', display: 'grid', gap: '0.75rem' }}>
        {formattedResults?.map((item, index) =>
            {
              const exp = expandedResult !==null && expandedResult.id=== item.id;
              const IconCompe = ICON_MAP[item.icon] || Zap
              return <div
              key={index}
              data-section={item.id}
            style={{
              borderRadius: '10px',
              background: 'var(--bg-card-alt)',
              overflow: 'hidden'
            }}
          >
            <div
                id={`section-${item.id}`}
                onClick={() => toggleResult(item)}
                style={{
                                    padding: '1rem 1.25rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  backgroundColor:item.id==="solutions"?"black":"",
                  color:item.id==="solutions"?"white":""
                }}
            >
              <div style={{flex: 1}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem'}}>
                  {item.id==="solutions"?<Zap size={20} style={{ color: '#fff' }} />:<IconCompe size={20} className="icon-red" />}
                  <h3 style={{fontSize: '0.95rem', fontWeight: 600,color: item.id==="solutions"?"white":'var(--text-primary)', margin: 0}}>
                    {item.name}
                  </h3>
                  {item.id==="solutions" && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '24px' }}>
                    <img src={intellistackLogo} alt="Intellistack" style={{ height: '22px' }} />
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#fff' }}>+</span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#C0392B' }}>XO</span>
                  </div>}
                  <span style={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    textTransform: 'uppercase'
                  }}>
                        {item.shortDescription?" - "+item.shortDescription:""}
                      </span>
                </div>

              </div>
              {item.id === 'technicalSection' && shouldRenderButton('Rapid Prototype', 'results') && systemButtons && systemButtons.filter(b => (b.label === 'Rapid Prototype' || b.name === 'Rapid Prototype') && !b.hidden).map((btn, bi) => {
                const BtnIcon = ICON_MAP[btn.icon] || Download
                return (
                  <button key={bi} data-dxo="prototype-spec" onClick={async (e) => {
                    e.stopPropagation()
                    setProtoDownloading(true)
                    try {
                      const res = await fetch(`${API_BASE}/rapid-prototype/${clientId}${activeEngagement?.id ? `?engagement_id=${activeEngagement.id}` : ''}`, { headers: getAuthHeaders() })
                      if (!res.ok) throw new Error('Failed to generate spec')
                      const blob = await res.blob()
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a'); a.href = url; a.download = 'PROTOTYPE-SPEC.md'; a.click()
                      URL.revokeObjectURL(url)
                    } catch (err) { alert('Prototype download failed: ' + err.message) }
                    setProtoDownloading(false)
                  }}
                  disabled={protoDownloading}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', background: btn.color || '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: protoDownloading ? 'wait' : 'pointer', flexShrink: 0, opacity: protoDownloading ? 0.7 : 1 }}>
                    {protoDownloading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <BtnIcon size={13} />} {btn.label}
                  </button>
                )
              })}
              {item.id === 'deploymentBrief' && shouldRenderButton('Download Brief', 'results') && (
                <button data-dxo="brief-download" onClick={async (e) => {
                  e.stopPropagation()
                  setBriefDownloadLoading(true)
                  try {
                    const res = await fetch(`${API_BASE}/results/${clientId}/brief`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ format: 'docx', engagement_id: activeEngagement?.id || undefined }) })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Download failed')
                    const byteChars = atob(data.content_base64)
                    const byteArray = new Uint8Array(byteChars.length)
                    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
                    const blob = new Blob([byteArray], { type: data.content_type })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a'); a.href = url; a.download = data.filename; a.click()
                    URL.revokeObjectURL(url)
                  } catch (err) { alert('Download failed: ' + err.message) }
                  setBriefDownloadLoading(false)
                }}
                disabled={briefDownloadLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: briefDownloadLoading ? 'wait' : 'pointer', flexShrink: 0, opacity: briefDownloadLoading ? 0.7 : 1 }}>
                  {briefDownloadLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />} Download Brief
                </button>
              )}
              {item.id === 'growthDeck' && shouldRenderButton('Download Deck', 'results') && (
                <button data-dxo="deck-preview" onClick={async (e) => {
                  e.stopPropagation()
                  setDeckDownloadLoading(true)
                  try {
                    const res = await fetch(`${API_BASE}/results/${clientId}/deck`, { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ engagement_id: activeEngagement?.id || undefined }) })
                    const data = await res.json()
                    if (!res.ok) throw new Error(data.error || 'Download failed')
                    const byteChars = atob(data.content_base64)
                    const byteArray = new Uint8Array(byteChars.length)
                    for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
                    const blob = new Blob([byteArray], { type: data.content_type })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a'); a.href = url; a.download = data.filename; a.click()
                    URL.revokeObjectURL(url)
                  } catch (err) { alert('Deck download failed: ' + err.message) }
                  setDeckDownloadLoading(false)
                }}
                disabled={deckDownloadLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: deckDownloadLoading ? 'wait' : 'pointer', flexShrink: 0, opacity: deckDownloadLoading ? 0.7 : 1 }}>
                  {deckDownloadLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />} Download Deck
                </button>
              )}
              {isDraft && (item.id === 'deploymentBrief' || item.id === 'growthDeck') && (
                <button onClick={(e) => { e.stopPropagation(); setShowReviewModal(item.id === 'growthDeck' ? 'deck' : 'brief') }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                  <Edit2 size={13} /> Review
                </button>
              )}
              {isDraft && (item.id === 'deploymentBrief' || item.id === 'growthDeck') && (() => {
                const isApproving = item.id === 'growthDeck' ? deckApproveLoading : briefApproveLoading
                return (
                <button onClick={(e) => { e.stopPropagation(); handleApprove(item.id === 'growthDeck' ? 'deck' : 'brief') }}
                  disabled={isApproving}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.75rem', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, cursor: isApproving ? 'wait' : 'pointer', flexShrink: 0, opacity: isApproving ? 0.7 : 1 }}>
                  {isApproving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={13} />} Approve
                </button>)
              })()}
              {!isDraft && (item.id === 'deploymentBrief' || item.id === 'growthDeck') && (
                <span style={{ fontSize: '0.65rem', background: '#dcfce7', color: '#16a34a', padding: '0.15rem 0.5rem', borderRadius: 4, fontWeight: 600, flexShrink: 0 }}>APPROVED</span>
              )}
              {isDraft && (item.id === 'deploymentBrief' || item.id === 'growthDeck') && (
                <span style={{ fontSize: '0.6rem', fontStyle: 'italic', color: '#DC2626', flexShrink: 0 }}>Draft — watermarked until reviewed and approved</span>
              )}
              {exp ? (
                  <ChevronDown size={20} style={{color: 'var(--text-secondary)', flexShrink: 0}}/>
              ) : (
                  <ChevronRight size={20} style={{color: 'var(--text-secondary)', flexShrink: 0}}/>
              )}
            </div>
            {exp && expandedResult && (
                <div style={{
                  padding: '0 1.25rem 1rem',
                  borderTop: '1px solid #e5e5e5'
                }}>
                  {
                    expandedResult.id==="executiveSummary"?
                      <div>
                        <div style={{ padding: '1.25rem', borderTop: '2px solid #0F969C' }}>
                          <div style={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text-primary)' }}>
                            {displayResults.summary!==null && displayResults.summary!==undefined?
                                <div>
                                  {displayPhrases.map((phrase, pIdx) => {
                                    if (pIdx === 0) {
                                      const sentenceEnd = phrase.match(/(?<![A-Z])\.(?:\s+)(?=[A-Z][a-z])/)
                                      const firstDot = sentenceEnd ? sentenceEnd.index : -1
                                      if (firstDot > 0 && firstDot < phrase.length - 1) {
                                        const headline = phrase.substring(0, firstDot + 1)
                                        const rest = phrase.substring(firstDot + 1).trim()
                                        return <div key={pIdx} style={{ margin: '0 0 1.5rem 0' }}>
                                          <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1a1a2e', lineHeight: 1.5, margin: '0 0 0.75rem 0' }}>{headline}</p>
                                          {rest && <p style={{ fontSize: '0.95rem', lineHeight: 1.7, color: '#333', margin: 0 }}>{rest}</p>}
                                        </div>
                                      }
                                      return <p key={pIdx} style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1a1a2e', lineHeight: 1.5, margin: '0 0 1.5rem 0' }}>{phrase}</p>
                                    }
                                    if (/^key metrics/i.test(phrase)) {
                                      const cleaned = phrase.replace(/^Key metrics:\s*/i, '').replace(/\s*\([^)]*\)\.?\s*$/, '')
                                      const sentences = cleaned.split(/,\s+/).map(s => s.replace(/^and\s+/i, '').trim()).filter(s => s && /\d/.test(s))
                                      const metrics = sentences.map(s => {
                                        const t = s.replace(/\.$/, '')
                                        const numMatch = t.match(/((?:~\s*)?[$£€¥]?\d[\d,]*(?:\.\d+)?(?:\s*[\-–]\s*(?:~\s*)?[$£€¥]?\d[\d,]*(?:\.\d+)?)?%?\+?(?:\s*(?:trillion|billion|million|thousand|T|B|M|K|k))?)/)
                                        if (!numMatch) return null
                                        const value = numMatch[0]
                                        const label = t.replace(value, '').replace(/^\s*[:\-–—~]\s*/, '').trim()
                                        return { value, label: label.charAt(0).toUpperCase() + label.slice(1) }
                                      }).filter(Boolean)
                                      if (metrics.length >= 2) {
                                        return (
                                          <div key={pIdx} style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                                            {metrics.map((m, mi) => (
                                              <div key={mi} style={{ flex: 1, minWidth: '180px', background: '#F1F5F9', borderRadius: 8, padding: '1rem', textAlign: 'center' }}>
                                                <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0F969C' }}>{m.value}</div>
                                                <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.35rem' }}>{m.label}</div>
                                              </div>
                                            ))}
                                          </div>
                                        )
                                      }
                                    }
                                    return <p key={pIdx} style={{ fontSize: '0.95rem', lineHeight: 1.7, color: '#333', margin: '0 0 1.5rem 0' }}>{phrase}</p>
                                  })}
                                  {/* Fallback: scan all text for metrics if no "Key metrics:" paragraph found */}
                                  {!displayPhrases.some(p => /^key metrics/i.test(p)) && (() => {
                                    const allText = displayPhrases.join(' ')
                                    const metricPatterns = allText.match(/(?:(?:~\s*)?[$£€¥]?\d[\d,]*(?:\.\d+)?(?:\s*[\-–]\s*(?:~\s*)?[$£€¥]?\d[\d,]*(?:\.\d+)?)?%?\+?(?:\s*(?:trillion|billion|million|thousand|T|B|M|K|k))?)\s+[a-zA-Z][a-zA-Z\s/]+(?=,|\.|;|\s+and\s|$)/g) || []
                                    const fallbackMetrics = metricPatterns.slice(0, 4).map(m => {
                                      const numMatch = m.match(/^((?:~\s*)?[$£€¥]?\d[\d,]*(?:\.\d+)?(?:\s*[\-–]\s*(?:~\s*)?[$£€¥]?\d[\d,]*(?:\.\d+)?)?%?\+?(?:\s*(?:trillion|billion|million|thousand|T|B|M|K|k))?)/)
                                      if (!numMatch) return null
                                      const value = numMatch[0]
                                      const label = m.replace(value, '').replace(/^\s*/, '').trim()
                                      return { value, label: label.charAt(0).toUpperCase() + label.slice(1) }
                                    }).filter(Boolean)
                                    if (fallbackMetrics.length >= 2) {
                                      return (
                                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                                          {fallbackMetrics.map((m, mi) => (
                                            <div key={mi} style={{ flex: 1, minWidth: '180px', background: '#F1F5F9', borderRadius: 8, padding: '1rem', textAlign: 'center' }}>
                                              <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#0F969C' }}>{m.value}</div>
                                              <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.35rem' }}>{m.label}</div>
                                            </div>
                                          ))}
                                        </div>
                                      )
                                    }
                                    return null
                                  })()}
                                </div>:"Not analysed yet"}
                          </div>
                        </div>
                        <div>
                        {formattedSummary?.map((summaryItem, index1) =>
                        {
                          const expSummary = expandedSummary !==null && expandedSummary.id=== summaryItem.id;
                          return <div
                              key={index1}
                              data-section={summaryItem.id}
                              style={{
                                borderRadius: '10px',
                                background: 'var(--bg-card-alt)',
                                overflow: 'hidden',
                                marginTop:"10px"
                              }}
                              className={"panel"}
                          >
                            <div
                                id={`section-${summaryItem.id}`}
                                onClick={() => toggleSummary(summaryItem)}
                                style={{
                                                                    padding: '1rem 1.25rem',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: '1rem'
                                }}
                                className={"panel-header"}
                            >
                              <div style={{flex: 1}}>
                                <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem'}}>
                                  {summaryItem.icon==="TrendingUp"?<TrendingUp size={20} className="icon-red" />:
                                      (summaryItem.icon==="Package"?<Package size={20} className="icon-red" />:
                                          (summaryItem.icon==="Zap"?<Zap size={20} className="icon-red" />:
                                              (summaryItem.icon==="AlertTriangle"?<AlertTriangle size={20} className="icon-red" />:
                                                  (summaryItem.icon==="Globe"?<Globe size={20} className="icon-red" />:<FileText size={20} className="icon-red" />))))}
                                  <h3 style={{fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0}}>
                                    {summaryItem.name}
                                  </h3>
                                  <span style={{
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    padding: '0.25rem 0.5rem',
                                    borderRadius: '4px',
                                    textTransform: 'uppercase'
                                  }}>

                      </span>
                                </div>

                              </div>
                              {expSummary ? (
                                  <ChevronDown size={20} style={{color: 'var(--text-secondary)', flexShrink: 0}}/>
                              ) : (
                                  <ChevronRight size={20} style={{color: 'var(--text-secondary)', flexShrink: 0}}/>
                              )}
                            </div>
                            {expSummary && expandedSummary && (
                                <div>
                                  {expandedSummary.id==="opportunitiesList"?<div>
                                        {displayResults.client_summary && (
                                            <div style={{ padding: '1.5rem', background: 'var(--bg-primary)' }}>
                                              {renderMarkdown(displayResults.client_summary)}
                                            </div>
                                          )}
                                      </div>:
                                      (expandedSummary.id==="bottomLine"?<div>
                                        {displayResults.bottom_line && (
                                          <div className="">
                                            <div style={{ padding: '1.25rem' }}>
                                              <div style={{
                                                background: 'rgba(220, 38, 38, 0.05)',
                                                border: '1px solid rgba(220, 38, 38, 0.15)',
                                                borderLeft: '4px solid #dc2626',
                                                borderRadius: '8px',
                                                padding: '1rem 1.25rem'
                                              }}>
                                                <p style={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>
                                                  {displayResults.bottom_line}
                                                </p>
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                      </div>:"")}
                                </div>
                            )}
                          </div>
                            })}
                        </div>
                      </div>:
                    (expandedResult.id==="problemsIdentified"?
                        <div>
                          {/* Problems Identified */}

                            <div style={{ padding: '1.25rem', display: 'grid', gap: '0.75rem' }}>
                              {displayResults.problems?.map((problem, index) => (
                                  <div
                                      key={index}
                                      data-section={`problem-${index}`}
                                      style={{
                                        border: `1px solid ${getSeverityColor(problem.severity)}20`,
                                        borderLeft: `4px solid ${getSeverityColor(problem.severity)}`,
                                        borderRadius: '10px',
                                        background: 'var(--bg-card-alt)',
                                        overflow: 'hidden'
                                      }}
                                  >
                                    <div
                                        id={`section-problem-${index}`}
                                        onClick={() => toggleProblem(index)}
                                        style={{
                                                                                    padding: '1rem 1.25rem',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: '1rem'
                                        }}
                                    >
                                      <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                                            {problem.title}
                                          </h3>
                                          <span style={{
                                            fontSize: '0.65rem',
                                            fontWeight: 700,
                                            padding: '0.25rem 0.5rem',
                                            borderRadius: '4px',
                                            background: getSeverityBg(problem.severity),
                                            color: getSeverityColor(problem.severity),
                                            textTransform: 'uppercase'
                                          }}>
                      {problem.severity}
                    </span>
                                        </div>
                                      </div>
                                      {expandedProblems[index] ? (
                                          <ChevronDown size={20} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                                      ) : (
                                          <ChevronRight size={20} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                                      )}
                                    </div>
                                    {expandedProblems[index] && (
                                        <div style={{
                                          padding: '0 1.25rem 1rem',
                                          borderTop: '1px solid #e5e5e5'
                                        }}>
                                          <div style={{ marginTop: '1rem' }}>
                                            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                                              Evidence
                                            </p>
                                            <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: '1rem' }}>
                                              {problem.evidence}
                                            </p>
                                          </div>
                                          <div>
                                            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                                              Recommendation
                                            </p>
                                            <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>
                                              {problem.recommendation}
                                            </p>
                                          </div>
                                        </div>
                                    )}
                                  </div>
                              ))}
                            </div>
                        </div>:
                    (expandedResult.id==="solutions"?
                        <div>
                          {/* Sub-block 1: Intellistack Potential Streamline Applications */}
                          <div data-section="streamline" style={{ margin: '0.75rem', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <div id="section-streamline" onClick={() => { const opening = !expandedSubBlocks.streamline; setExpandedSubBlocks(prev => ({ ...prev, streamline: opening })); if (opening) setLastExpandedSection('streamline'); }} style={{ background: '#000', padding: '0.625rem 1rem', display: 'flex', alignItems: 'center', gap: '0.625rem', cursor: 'pointer', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                                <img src={intellistackLogo} alt="Intellistack" style={{ height: '20px' }} />
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }}>Potential Streamline Applications</span>
                              </div>
                              {expandedSubBlocks.streamline ? <ChevronDown size={18} style={{ color: '#fff', flexShrink: 0 }} /> : <ChevronRight size={18} style={{ color: '#fff', flexShrink: 0 }} />}
                            </div>
                          {expandedSubBlocks.streamline && displayResults.streamline_applications && (
                              <div style={{ padding: '1.5rem', background: 'var(--bg-primary)' }}>
                                  {(() => {
                                    const displayStreamlineApplications = []
                                    const sapps = displayResults.streamline_applications.split("\n\n")
                                    for (const sapp of sapps) {
                                      if (sapp.trim().indexOf(". ") >= 0) {
                                        const sappComps = sapp.split("\n")
                                        if (sappComps.length > 3) {
                                          const titleSplit = sappComps[0].replaceAll("*", "").split(". ")
                                          displayStreamlineApplications.push({
                                            rank: titleSplit[0], title: titleSplit[1],
                                            problem: sappComps[1].replace("Problem: ", ""),
                                            workflow: sappComps[2].replace("Workflow: ", "").split(" → "),
                                            integrations: sappComps[3].replace("Integrations: ", ""),
                                            outcome: sappComps[4]?.replace("Outcome: ", "")
                                          })
                                        }
                                      }
                                    }
                                    let currentAppIndex = -1
                                    return displayResults.streamline_applications.split('\n').filter(line => line.trim()).map((line, idx) => {
                                    const trimmed = line.trim()
                                    const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/)
                                    if (boldMatch) {
                                      currentAppIndex++
                                      return (
                                          <h3 key={idx} style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', margin: idx === 0 ? '0 0 0.5rem 0' : '1.25rem 0 0.5rem 0' }}>
                                            {boldMatch[1]}
                                          </h3>
                                      )
                                    }
                                    const labelMatch = trimmed.match(/^(Problem|Workflow|Integrations|Outcome):\s*(.+)/)
                                    if (labelMatch) {
                                      const isOutcome = labelMatch[1] === 'Outcome'
                                      const appIdx = currentAppIndex
                                      const appData = displayStreamlineApplications[appIdx]
                                      const bStatus = buildingWorkflow[appIdx]
                                      const bResult = buildResults[appIdx]
                                      return (
                                          <div key={idx}>
                                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.35rem', paddingLeft: '0.75rem' }}>
                                              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: labelMatch[1] === 'Problem' ? '#ef4444' : labelMatch[1] === 'Workflow' ? '#3b82f6' : '#6b7280', minWidth: '90px', flexShrink: 0 }}>{labelMatch[1]}:</span>
                                              <span style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>{labelMatch[2]}</span>
                                            </div>
                                            {isOutcome && appData && shouldRenderButton('Build in Streamline', 'results') && (
                                              <div style={{ paddingLeft: '0.75rem', marginTop: '0.5rem', marginBottom: '0.25rem' }}>
                                                {bStatus === 'done' && bResult ? (
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <CheckCircle size={14} style={{ color: '#22c55e' }} />
                                                    <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 600 }}>Built in Streamline</span>
                                                    {bResult.needs_ui_config?.length > 0 && (
                                                      <span style={{ fontSize: '0.65rem', color: '#f59e0b' }}>({bResult.needs_ui_config.length} steps need UI config)</span>
                                                    )}
                                                  </div>
                                                ) : (
                                                  <button
                                                    disabled={bStatus === 'building'}
                                                    onClick={async () => {
                                                      setBuildingWorkflow(prev => ({ ...prev, [appIdx]: 'building' }))
                                                      try {
                                                        const res = await fetch(`${API_BASE}/build-workflow`, {
                                                          method: 'POST', headers: getAuthHeaders(),
                                                          body: JSON.stringify({
                                                            client_id: clientId,
                                                            engagement_id: activeEngagement?.id || undefined,
                                                            app_index: appIdx,
                                                            app_data: appData
                                                          })
                                                        })
                                                        const data = await res.json()
                                                        if (data.build_id) {
                                                          // Poll for completion
                                                          const pollBuild = async () => {
                                                            for (let i = 0; i < 30; i++) {
                                                              await new Promise(r => setTimeout(r, 3000))
                                                              try {
                                                                const sr = await fetch(`${API_BASE}/build-workflow/${data.build_id}`, { headers: getAuthHeaders() })
                                                                const sd = await sr.json()
                                                                if (sd.status === 'complete') {
                                                                  setBuildingWorkflow(prev => ({ ...prev, [appIdx]: 'done' }))
                                                                  setBuildResults(prev => ({ ...prev, [appIdx]: { success: true, project_id: sd.project_id, needs_ui_config: sd.needs_ui_config || [] } }))
                                                                  return
                                                                } else if (sd.status === 'failed') {
                                                                  setBuildingWorkflow(prev => ({ ...prev, [appIdx]: 'error' }))
                                                                  alert('Build failed: ' + (sd.error || 'Unknown error'))
                                                                  return
                                                                }
                                                              } catch (_) { /* poll again */ }
                                                            }
                                                            setBuildingWorkflow(prev => ({ ...prev, [appIdx]: 'error' }))
                                                            alert('Build timed out — check Streamline for results')
                                                          }
                                                          pollBuild()
                                                        } else if (data.success) {
                                                          setBuildingWorkflow(prev => ({ ...prev, [appIdx]: 'done' }))
                                                          setBuildResults(prev => ({ ...prev, [appIdx]: data }))
                                                        } else {
                                                          setBuildingWorkflow(prev => ({ ...prev, [appIdx]: 'error' }))
                                                          alert('Build failed: ' + (data.error || 'Unknown error'))
                                                        }
                                                      } catch (err) {
                                                        setBuildingWorkflow(prev => ({ ...prev, [appIdx]: 'error' }))
                                                        alert('Build failed: ' + err.message)
                                                      }
                                                    }}
                                                    style={{
                                                      display: 'flex', alignItems: 'center', gap: '0.35rem',
                                                      padding: '0.3rem 0.6rem', fontSize: '0.7rem', fontWeight: 600,
                                                      background: bStatus === 'building' ? '#94a3b8' : bStatus === 'error' ? '#ef4444' : '#2563eb',
                                                      color: '#fff', border: 'none', borderRadius: 6,
                                                      cursor: bStatus === 'building' ? 'wait' : 'pointer',
                                                    }}>
                                                    {bStatus === 'building' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={12} />}
                                                    {bStatus === 'building' ? 'Building...' : bStatus === 'error' ? 'Retry Build' : 'Build in Streamline'}
                                                  </button>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                      )
                                    }
                                    // Bullet points
                                    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                                      return (
                                          <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.5rem', paddingLeft: '0.5rem' }}>
                                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4b5563', marginTop: '0.5rem', flexShrink: 0 }} />
                                            <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-primary)', margin: 0 }}>{trimmed.substring(2)}</p>
                                          </div>
                                      )
                                    }
                                    // Regular paragraphs
                                    return (
                                        <p key={idx} style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                                          {trimmed}
                                        </p>
                                    )
                                  })})()}
                              </div>
                          )}
                          </div>

                          {/* Sub-block 2: Intellagentic XO */}
                          <div data-section="xo" style={{ margin: '0.75rem', marginTop: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <div id="section-xo" onClick={() => { const opening = !expandedSubBlocks.xo; setExpandedSubBlocks(prev => ({ ...prev, xo: opening })); if (opening) setLastExpandedSection('xo'); }} style={{ background: '#000', padding: '0.625rem 1rem', display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: 'pointer', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff' }}>Intellagentic</span>
                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#C0392B' }}>XO</span>
                              </div>
                              {expandedSubBlocks.xo ? <ChevronDown size={18} style={{ color: '#fff', flexShrink: 0 }} /> : <ChevronRight size={18} style={{ color: '#fff', flexShrink: 0 }} />}
                            </div>
                          </div>
                          {expandedSubBlocks.xo && (() => {
                              const apps = displayResults.xo_applications
                              if (!apps || !Array.isArray(apps) || apps.length === 0) {
                                return (
                                  <div style={{ margin: '0.75rem', marginTop: '12px', padding: '1.25rem', background: 'var(--bg-card-alt)', borderRadius: 8, border: '1px solid var(--border-color, #e5e7eb)' }}>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #9ca3af)', fontStyle: 'italic', margin: 0 }}>XO applications will appear here after enrichment with the latest model.</p>
                                  </div>
                                )
                              }
                              return (
                                <div style={{ margin: '0.75rem', marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                  {apps.map((app, i) => (
                                    <div key={i} style={{ background: 'var(--bg-card-alt)', borderRadius: 8, border: '1px solid var(--border-color, #e5e7eb)', overflow: 'hidden' }}>
                                      <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color, #e5e7eb)', display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#fff', background: '#C0392B', width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</span>
                                        <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{app.title}</h4>
                                      </div>
                                      <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        {app.problem && (
                                          <div>
                                            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted, #9ca3af)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Problem</div>
                                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)', margin: 0 }}>{app.problem}</p>
                                          </div>
                                        )}
                                        {app.capability && (
                                          <div>
                                            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted, #9ca3af)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>XO Capability</div>
                                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)', margin: 0 }}>{app.capability}</p>
                                          </div>
                                        )}
                                        {app.integrations && (
                                          <div>
                                            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted, #9ca3af)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Integrations</div>
                                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)', margin: 0 }}>{app.integrations}</p>
                                          </div>
                                        )}
                                        {app.outcome && (
                                          <div style={{ background: 'rgba(15, 150, 156, 0.08)', borderRadius: 6, padding: '0.75rem 1rem', borderLeft: '3px solid #0F969C' }}>
                                            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#0F969C', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Outcome</div>
                                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, color: 'var(--text-primary)', margin: 0 }}>{app.outcome}</p>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )
                            })()}
                        </div>:
                    (expandedResult.id==="rapidDeployment"?
                        <div>
                          {/* 7/14/21 Day Plan */}
                          <div style={{ padding: '1.25rem', display: 'grid', gap: '1rem' }}>
                              {displayResults.plan?.map((phase, index) => (
                                  <div
                                      key={index}
                                      style={{
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '10px',
                                        background: 'var(--bg-card-alt)',
                                        padding: '1rem 1.25rem'
                                      }}
                                  >
                                    <h3 style={{
                                      fontSize: '0.9rem',
                                      fontWeight: 700,
                                      color: '#dc2626',
                                      marginBottom: '0.75rem',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.05em'
                                    }}>
                                      {phase.phase}
                                    </h3>
                                    <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '0.5rem' }}>
                                      {phase.actions?.map((action, actionIndex) => (
                                          <li key={actionIndex} style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-primary)',display:"inherit" }}>
                                            {action}
                                          </li>
                                      ))}
                                    </ul>
                                  </div>
                              ))}
                            </div>
                        </div>:
                    (expandedResult.id==="technicalSection"?
                        <div>
                          {/* Proposed Architecture */}
                          {displayResults.architecture_diagram && (
                              <div className="panel" data-dxo="architecture-slide" style={{marginTop:"20px",marginBottom:"10px"}}>
                                <div className="panel-header">
                                  <div className="panel-header-left">
                                    <Package size={20} className="icon-red" />
                                    <h2>Proposed Architecture</h2>
                                  </div>
                                </div>
                                <div style={{ padding: '1.25rem' }}>
            <pre style={{
              background: 'var(--bg-card-alt)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1.25rem',
              fontSize: '0.75rem',
              lineHeight: 1.5,
              fontFamily: 'Monaco, Menlo, Consolas, monospace',
              color: 'var(--text-primary)',
              overflowX: 'auto',
              margin: 0,
              whiteSpace: 'pre'
            }}>
              {displayResults.architecture_diagram}
            </pre>
                                </div>
                              </div>
                          )}

                          {/* Component Mapping (admin only, collapsed by default) */}
                          {isAdmin && displayResults.component_mapping && (
                            <div className="panel" style={{marginTop:"20px",marginBottom:"10px"}}>
                              <div className="panel-header" onClick={() => setComponentMappingExpanded(!componentMappingExpanded)} style={{ cursor: 'pointer' }}>
                                <div className="panel-header-left">
                                  <Database size={20} className="icon-red" />
                                  <h2>Component Mapping</h2>
                                  <span className="badge-count blue">{(displayResults.component_mapping.fits?.length || 0) + (displayResults.component_mapping.extends?.length || 0) + (displayResults.component_mapping.new_components?.length || 0)}</span>
                                </div>
                                {componentMappingExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                              </div>
                              {componentMappingExpanded && (() => {
                                const cm = displayResults.component_mapping
                                return <div style={{ padding: '1.25rem' }}>
                                  {cm.summary_line && <div style={{ background: '#EDF2F8', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600, color: '#1B2A4A' }}>{cm.summary_line}</div>}
                                  {cm.fits && cm.fits.length > 0 && <>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>FITS -- Existing Components</div>
                                    {cm.fits.map((f, i) => (
                                      <div key={i} style={{ borderLeft: '4px solid #22c55e', background: '#f0fdf4', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1a1a2e' }}>{f.component} {f.version && <span style={{ color: '#6b7280', fontWeight: 400 }}>{f.version}</span>}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#333', marginTop: '0.25rem' }}>{f.capability}</div>
                                        {f.config_notes && <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem', fontStyle: 'italic' }}>Config: {f.config_notes}</div>}
                                      </div>
                                    ))}
                                  </>}
                                  {cm.extends && cm.extends.length > 0 && <>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '1rem', marginBottom: '0.5rem' }}>EXTENDS -- Component Extensions</div>
                                    {cm.extends.map((e, i) => (
                                      <div key={i} style={{ borderLeft: '4px solid #d97706', background: '#fffbeb', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1a1a2e' }}>{e.component} {e.from_version} → {e.to_version}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#333', marginTop: '0.25rem' }}>{e.capability}</div>
                                        {e.extension_notes && <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem', fontStyle: 'italic' }}>Extension: {e.extension_notes}</div>}
                                      </div>
                                    ))}
                                  </>}
                                  {cm.new_components && cm.new_components.length > 0 && <>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '1rem', marginBottom: '0.5rem' }}>NEW COMPONENT NEEDED</div>
                                    {cm.new_components.map((n, i) => (
                                      <div key={i} style={{ borderLeft: '4px solid #dc2626', background: '#fef2f2', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1a1a2e' }}>{n.proposed_name}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#333', marginTop: '0.25rem' }}>{n.purpose}</div>
                                        {n.justification && <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem', fontStyle: 'italic' }}>{n.justification}</div>}
                                      </div>
                                    ))}
                                  </>}
                                </div>
                              })()}
                            </div>
                          )}

                          {/* Proposed Schema */}
                          <div className="panel" style={{marginTop:"20px",marginBottom:"10px"}}>
                            <div className="panel-header">
                              <div className="panel-header-left">
                                <Database size={20} className="icon-red" />
                                <h2>Proposed Data Schema</h2>
                                <span className="badge-count blue">{displayResults.schema?.tables?.length || 0} Tables</span>
                              </div>
                            </div>
                            <div style={{ padding: '1.25rem', display: 'grid', gap: '0.75rem' }}>
                              {displayResults.schema?.tables?.map((table, index) => (
                                  <div
                                      key={index}
                                      style={{
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '10px',
                                        background: 'var(--bg-card-alt)',
                                        overflow: 'hidden'
                                      }}
                                  >
                                    <div
                                        onClick={() => toggleTable(table.name)}
                                        style={{
                                          padding: '1rem 1.25rem',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: '1rem'
                                        }}
                                    >
                                      <div>
                                        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                                          {table.name}
                                        </h3>
                                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                                          {table.purpose}
                                        </p>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <span className="badge-count blue">{table.columns?.length || 0} columns</span>
                                        {expandedTables[table.name] ? (
                                            <ChevronDown size={20} style={{ color: 'var(--text-secondary)' }} />
                                        ) : (
                                            <ChevronRight size={20} style={{ color: 'var(--text-secondary)' }} />
                                        )}
                                      </div>
                                    </div>
                                    {expandedTables[table.name] && (
                                        <div style={{
                                          padding: '0 1.25rem 1rem',
                                          borderTop: '1px solid #e5e5e5'
                                        }}>
                                          <div style={{ marginTop: '1rem' }}>
                                            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                                              <thead>
                                              <tr style={{ borderBottom: '2px solid #e5e5e5' }}>
                                                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Column</th>
                                                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Type</th>
                                                <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Description</th>
                                              </tr>
                                              </thead>
                                              <tbody>
                                              {table.columns?.map((col, colIndex) => (
                                                  <tr key={colIndex} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                                    <td style={{ padding: '0.625rem 0.5rem', fontWeight: 500, color: 'var(--text-primary)' }}>{col.name}</td>
                                                    <td style={{ padding: '0.625rem 0.5rem', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.75rem' }}>{col.type}</td>
                                                    <td style={{ padding: '0.625rem 0.5rem', color: 'var(--text-secondary)' }}>{col.description}</td>
                                                  </tr>
                                              ))}
                                              </tbody>
                                            </table>
                                          </div>
                                        </div>
                                    )}
                                  </div>
                              ))}
                              {/* Schema Relationships */}
                              {displayResults.schema?.relationships?.length > 0 && (
                                  <div style={{
                                    marginTop: '0.25rem',
                                    padding: '0.75rem 1rem',
                                    background: 'var(--bg-card-alt)',
                                    borderRadius: '8px',
                                    border: '1px solid var(--border-color)'
                                  }}>
                                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                                      Relationships
                                    </p>
                                    {displayResults.schema.relationships.map((rel, i) => (
                                        <p key={i} style={{
                                          fontSize: '0.8rem',
                                          color: 'var(--text-primary)',
                                          fontFamily: 'Monaco, Menlo, Consolas, monospace',
                                          margin: '0.25rem 0',
                                          lineHeight: 1.5
                                        }}>
                                          {rel}
                                        </p>
                                    ))}
                                  </div>
                              )}
                            </div>
                          </div>

                          {/* Data Sources*/}
                          <div className="panel">
                            <div className="panel-header">
                              <div className="panel-header-left">
                                <Globe size={20} className="icon-red" />
                                <h2>Data Sources</h2>
                                <span className="badge-count">{displayResults.sources?.length || 0}</span>
                              </div>
                            </div>
                            <div style={{ padding: '1.25rem' }}>
                              <div style={{ display: 'grid', gap: '0.5rem' }}>
                                {displayResults.sources?.map((source, index) => (
                                    <div
                                        key={index}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'flex-start',
                                          gap: '0.75rem',
                                          padding: '0.75rem',
                                          background: 'var(--bg-card-alt)',
                                          borderRadius: '8px',
                                          fontSize: '0.85rem'
                                        }}
                                    >
                <span style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  background: source.type === 'client_data' ? 'rgba(220, 38, 38, 0.1)' : source.type === 'web_enrichment' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                  color: source.type === 'client_data' ? '#dc2626' : source.type === 'web_enrichment' ? '#3b82f6' : '#6b7280',
                  textTransform: 'uppercase',
                  flexShrink: 0
                }}>
                  {source.type.replace('_', ' ')}
                </span>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <span style={{ color: 'var(--text-primary)' }}>{source.reference}</span>
                                        {source.consolidated_with?.length > 0 && (
                                          <div style={{
                                            marginTop: '0.35rem',
                                            fontSize: '0.7rem',
                                            color: 'var(--text-muted)',
                                            fontStyle: 'italic'
                                          }}>
                                            Consolidated with {source.consolidated_with.length} other file{source.consolidated_with.length > 1 ? 's' : ''}
                                            {source.unique_angle ? ` — unique angle: ${source.unique_angle}` : ''}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>:
                    (expandedResult.id==="deploymentBrief"?
                        <div style={{ padding: '1.25rem' }}>
                          {isDraft && <div style={{ background: '#FEE2E2', border: '2px dashed #DC2626', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', textAlign: 'center' }}><div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#DC2626', letterSpacing: '0.15em' }}>DRAFT</div><div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.15rem' }}>Watermarked until reviewed and approved</div></div>}
                          {(() => { const brief = assembleBrief(displayResults, currentClient); return brief ? (
                            <div>
                              <div id="deployment-brief-content">
                              {/* Cover */}
                              {brief.cover && (
                                <div style={{
                                  background: 'linear-gradient(135deg, #0F969C 0%, #0a7075 100%)',
                                  borderRadius: 10, padding: '1.5rem', marginBottom: '1.25rem', color: '#fff'
                                }}>
                                  <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                                    {brief.cover.headline || 'XO Deployment Brief'}
                                  </h2>
                                  <p style={{ fontSize: '0.95rem', opacity: 0.9, marginBottom: '0.5rem' }}>
                                    {brief.cover.client_name} — {brief.cover.client_descriptor}
                                  </p>
                                  <p style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                                    {brief.cover.value_proposition}
                                  </p>
                                </div>
                              )}

                              {/* Executive Summary */}
                              {brief.executive_summary && (
                                <div style={{ marginBottom: '1.25rem' }}>
                                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Executive Summary</h3>
                                  <div style={{ color: 'var(--text-primary)' }}>
                                    {renderMarkdown(brief.executive_summary)}
                                  </div>
                                </div>
                              )}

                              {/* Key Metrics */}
                              {brief.key_metrics && brief.key_metrics.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                                  {brief.key_metrics.map((m, i) => (
                                    <div key={i} style={{
                                      flex: '1 1 140px', padding: '0.75rem 1rem',
                                      background: 'var(--bg-card-alt)', borderRadius: 8,
                                      border: '1px solid var(--border-color)', textAlign: 'center'
                                    }}>
                                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F969C' }}>{m.value}</div>
                                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', marginTop: '0.15rem' }}>{m.label}</div>
                                      {m.sublabel && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{m.sublabel}</div>}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Numbered Sections */}
                              {brief.sections && brief.sections.map((sec, i) => (
                                <div key={i} style={{ marginBottom: '1.25rem' }} className={i > 0 ? 'pdf-page-break' : ''}>
                                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                                    <span style={{ color: '#0F969C', fontWeight: 700 }}>{sec.number}</span>{' '}
                                    <span style={{ color: 'var(--text-primary)' }}>{sec.title}</span>
                                  </h3>
                                  <div style={{ color: 'var(--text-primary)' }}>
                                    {renderMarkdown(sec.content)}
                                  </div>
                                  {sec.callout && (
                                    <div style={{
                                      marginTop: '0.75rem', padding: '0.75rem 1rem',
                                      background: 'rgba(15, 150, 156, 0.08)',
                                      borderLeft: '4px solid #0F969C', borderRadius: 6,
                                      fontSize: '0.85rem', color: 'var(--text-primary)'
                                    }}>
                                      <strong style={{ color: '#0F969C' }}>{sec.callout.label}</strong>
                                      <p style={{ margin: '0.25rem 0 0' }}>{sec.callout.content}</p>
                                    </div>
                                  )}
                                </div>
                              ))}

                              {/* OODA Phases */}
                              {brief.ooda_phases && brief.ooda_phases.length > 0 && (
                                <div style={{ marginBottom: '1.25rem' }}>
                                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>OODA Workflow</h3>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
                                    {brief.ooda_phases.map((phase, i) => (
                                      <div key={i} style={{
                                        padding: '0.75rem', background: 'var(--bg-card-alt)',
                                        borderRadius: 8, border: '1px solid var(--border-color)'
                                      }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0F969C', letterSpacing: '0.05em' }}>{phase.name}</div>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>{phase.tagline}</div>
                                        <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                          {phase.bullets?.map((b, j) => <li key={j} style={{ marginBottom: '0.15rem' }}>{b}</li>)}
                                        </ul>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* POC Timeline */}
                              {brief.poc_timeline && brief.poc_timeline.length > 0 && (
                                <div style={{ marginBottom: '1.25rem' }}>
                                  <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>Proof of Concept Timeline</h3>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                    <thead>
                                      <tr style={{ background: 'var(--bg-card-alt)' }}>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)', fontWeight: 600 }}>Step</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)', fontWeight: 600 }}>Timeline</th>
                                        <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border-color)', fontWeight: 600 }}>Action</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {brief.poc_timeline.map((row, i) => (
                                        <tr key={i}>
                                          <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', fontWeight: 600, color: '#0F969C' }}>{row.step}</td>
                                          <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' }}>{row.timeline}</td>
                                          <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border-color)' }}>{row.action}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Success Metric */}
                              {brief.success_metric && (
                                <div style={{
                                  padding: '0.75rem 1rem', background: 'rgba(15, 150, 156, 0.08)',
                                  borderLeft: '4px solid #0F969C', borderRadius: 6,
                                  fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)'
                                }}>
                                  <strong>Success Metric:</strong> {brief.success_metric}
                                </div>
                              )}
                            </div>
                            </div>
                          ) : (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                              <FileText size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
                              <p style={{ fontSize: '0.9rem' }}>Brief generation not available for this analysis.</p>
                              <p style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Re-run enrichment to generate a Deployment Brief.</p>
                            </div>
                          )})()}
                        </div>:
                    (expandedResult.id==="growthDeck"?
                        <div style={{ padding: '1.25rem' }}>
                          {isDraft && <div style={{ background: '#FEE2E2', border: '2px dashed #DC2626', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', textAlign: 'center' }}><div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#DC2626', letterSpacing: '0.15em' }}>DRAFT</div><div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '0.15rem' }}>Watermarked until reviewed and approved</div></div>}
                          {(() => { const deck = assembleDeckData(displayResults, currentClient, activeEngagement?.name); return deck ? (
                            <div>
                              {/* Slide 1: Title */}
                              <div style={{ background: '#1B2A4A', borderRadius: 12, padding: '2rem', marginBottom: '1rem', position: 'relative', overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', top: 0, right: 0, width: 200, height: 120, background: 'rgba(46,117,182,0.15)', borderRadius: '0 12px 0 80px' }} />
                                <div style={{ fontSize: '0.7rem', color: '#B0BEC5', marginBottom: '1rem', letterSpacing: '0.05em' }}>SLIDE 1 OF 8</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '1.5rem' }}>
                                  <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>Intellagentic</span>
                                  <span style={{ fontWeight: 700, color: '#C0392B', fontSize: '0.9rem' }}>XO</span>
                                </div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', lineHeight: 1.3, marginBottom: '0.75rem', fontFamily: 'Georgia, serif' }}>{deck.title.replace('\n', ' ')}</div>
                                <div style={{ width: 60, height: 3, background: '#C0392B', marginBottom: '0.75rem' }} />
                                <div style={{ fontSize: '0.8rem', color: '#B0BEC5', fontStyle: 'italic', marginBottom: '1rem' }}>You are the domain experts. This is our take on status and next steps.</div>
                                <div style={{ fontSize: '0.85rem', color: '#F0F4F8' }}>{deck.contactLine}</div>
                                <div style={{ fontSize: '0.7rem', color: '#555', fontStyle: 'italic', marginTop: '0.75rem' }}>CONFIDENTIAL</div>
                              </div>

                              {/* Slide 2: Status & Challenges */}
                              <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', marginBottom: '1rem', border: '1px solid #e5e7eb' }}>
                                <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>SLIDE 2 OF 8</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1B2A4A', marginBottom: '1rem', fontFamily: 'Georgia, serif' }}>{deck.slideTitle}</div>
                                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                                  {deck.stats.map((st, i) => (
                                    <div key={i} style={{ flex: '1 1 140px', background: '#EDF2F8', borderRadius: 8, padding: '0.75rem', borderTop: '3px solid #2E75B6' }}>
                                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1B2A4A' }}>{st.num}</div>
                                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2E75B6' }}>{st.label}</div>
                                      <div style={{ fontSize: '0.65rem', color: '#555' }}>{st.sub}</div>
                                    </div>
                                  ))}
                                </div>
                                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1B2A4A', marginBottom: '0.5rem', fontFamily: 'Georgia, serif' }}>{deck.challengeTitle}</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
                                  {deck.challenges.map((c, i) => (
                                    <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#C0392B', marginTop: 4, flexShrink: 0 }} />
                                      <div><span style={{ fontWeight: 600, color: '#1B2A4A', fontSize: '0.8rem' }}>{c.title} </span><span style={{ color: '#555', fontSize: '0.75rem' }}>{c.desc}</span></div>
                                    </div>
                                  ))}
                                </div>
                                {deck.problemCallout && <div style={{ background: '#FFF3CD', borderRadius: 6, padding: '0.5rem 0.75rem', fontSize: '0.75rem', fontStyle: 'italic', color: '#1B2A4A' }}>{deck.problemCallout}</div>}
                              </div>

                              {/* Slide 3: Protocol vs Probability */}
                              <div style={{ background: '#1B2A4A', borderRadius: 12, padding: '1.5rem', marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.7rem', color: '#B0BEC5', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>SLIDE 3 OF 8</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', marginBottom: '1rem', fontFamily: 'Georgia, serif' }}>Protocol vs Probability</div>
                                <div style={{ borderRadius: 8, overflow: 'hidden', marginBottom: '1rem' }}>
                                  {[
                                    { label: 'Foundation', ai: 'Probability-based (statistical guessing)', xo: 'Protocol-based (codified domain rules)' },
                                    { label: 'Engagement', ai: 'Passive "Pull Model" (waits for a prompt)', xo: 'Active "Command Loop" (24/7 scanning)' },
                                    { label: 'Identity', ai: 'Conversational Assistant', xo: 'Sovereign Decision Engine' },
                                    { label: 'Output', ai: 'High liability, prone to hallucinations', xo: 'Pre-compliant, evidence-bound' },
                                  ].map((row, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', gap: 0, borderBottom: i < 3 ? '1px solid rgba(255,255,255,0.1)' : 'none' }}>
                                      <div style={{ padding: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: '#F0F4F8' }}>{row.label}</div>
                                      <div style={{ padding: '0.5rem', fontSize: '0.7rem', color: '#B0BEC5', background: 'rgba(255,255,255,0.03)' }}>{row.ai}</div>
                                      <div style={{ padding: '0.5rem', fontSize: '0.7rem', color: '#F0F4F8', fontWeight: 600, background: 'rgba(46,117,182,0.1)' }}>{row.xo}</div>
                                    </div>
                                  ))}
                                </div>
                                <div style={{ background: '#1A2030', borderRadius: 8, padding: '0.75rem', borderLeft: '3px solid #C0392B' }}>
                                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff', marginBottom: '0.25rem' }}>{deck.constitutionalSafetyTitle}</div>
                                  <div style={{ fontSize: '0.7rem', color: '#B0BEC5' }}>{deck.constitutionalSafetyNote}</div>
                                </div>
                                <div style={{ textAlign: 'center', fontSize: '0.75rem', fontStyle: 'italic', color: '#2E75B6', marginTop: '0.75rem' }}>Every other AI product guesses. We follow your rules.</div>
                              </div>

                              {/* Slide 4: OODA Loop */}
                              <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', marginBottom: '1rem', border: '1px solid #e5e7eb' }}>
                                <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>SLIDE 4 OF 8</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1B2A4A', marginBottom: '1rem', fontFamily: 'Georgia, serif' }}>The XO Command Loop for {deck.oodaTitle}{activeEngagement?.name ? ` \u2014 ${activeEngagement.name}` : ''}</div>
                                {deck.oodaPhases.map((o, i) => {
                                  const colors = { OBSERVE: '#2E75B6', ORIENT: '#1B2A4A', DECIDE: '#C0392B', ACT: '#27AE60' }
                                  return (
                                    <div key={i} style={{ background: '#EDF2F8', borderRadius: 8, padding: '0.75rem', marginBottom: '0.5rem', borderLeft: `4px solid ${colors[o.phase] || '#2E75B6'}` }}>
                                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: colors[o.phase] || '#2E75B6' }}>{o.phase}</div>
                                      <div style={{ fontSize: '0.7rem', color: '#555' }}>{o.desc}</div>
                                    </div>
                                  )
                                })}
                                <div style={{ background: '#EDF2F8', borderRadius: 8, padding: '0.75rem', marginTop: '0.75rem', border: '1px solid #2E75B6' }}>
                                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#1B2A4A' }}>Maturity Roadmap</div>
                                  <div style={{ fontSize: '0.7rem', color: '#2E75B6', marginTop: '0.25rem' }}>L1: Monitor  →  L2: Recommend  →  L3: Bounded Autonomy  →  L4: Full Autonomous Operation</div>
                                  <div style={{ fontSize: '0.65rem', color: '#555', fontStyle: 'italic', marginTop: '0.25rem' }}>{deck.maturityStart}</div>
                                </div>
                              </div>

                              {/* Slide 5: Workflows */}
                              <div style={{ background: '#1B2A4A', borderRadius: 12, padding: '1.5rem', marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.7rem', color: '#B0BEC5', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>SLIDE 5 OF 8</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', marginBottom: '1rem', fontFamily: 'Georgia, serif' }}>{deck.workflowTitle}</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                  {deck.workflows.map((w, i) => {
                                    const accentColors = { BLUE: '#2E75B6', RED: '#C0392B', GREEN: '#27AE60' }
                                    return (
                                      <div key={i} style={{ background: '#1A2030', borderRadius: 8, padding: '0.75rem', borderTop: `3px solid ${accentColors[w.accent] || '#2E75B6'}` }}>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff', marginBottom: '0.25rem' }}>{w.title}</div>
                                        <div style={{ fontSize: '0.7rem', color: '#B0BEC5' }}>{w.desc}</div>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>

                              {/* Slide 6: Before & After */}
                              <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', marginBottom: '1rem', border: '1px solid #e5e7eb' }}>
                                <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>SLIDE 6 OF 8</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1B2A4A', marginBottom: '1rem', fontFamily: 'Georgia, serif' }}>{deck.beforeAfterTitle}</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderRadius: 8, overflow: 'hidden' }}>
                                  <div style={{ background: '#555', padding: '0.4rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, color: '#fff', textAlign: 'center' }}>SYSTEM OF RECORD</div>
                                  <div style={{ background: '#2E75B6', padding: '0.4rem 0.75rem', fontSize: '0.75rem', fontWeight: 600, color: '#fff', textAlign: 'center' }}>SYSTEM OF ACTION</div>
                                  {deck.comparisons.map((c, i) => (
                                    <React.Fragment key={i}>
                                      <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.7rem', color: '#555', background: i % 2 === 0 ? '#EDF2F8' : '#fff' }}>{c.before}</div>
                                      <div style={{ padding: '0.4rem 0.75rem', fontSize: '0.7rem', color: '#1B2A4A', fontWeight: 600, background: i % 2 === 0 ? '#EDF2F8' : '#fff' }}>{c.after}</div>
                                    </React.Fragment>
                                  ))}
                                </div>
                                {deck.impactLine && <div style={{ background: '#1B2A4A', borderRadius: 6, padding: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: '#fff', textAlign: 'center', marginTop: '0.75rem' }}>{deck.impactLine}</div>}
                                <div style={{ textAlign: 'center', fontSize: '0.7rem', fontStyle: 'italic', color: '#2E75B6', marginTop: '0.5rem' }}>XO sits on top of existing systems — zero rip-and-replace.</div>
                              </div>

                              {/* Slide 7: 21-Day POC */}
                              <div style={{ background: '#EDF2F8', borderRadius: 12, padding: '1.5rem', marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>SLIDE 7 OF 8</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1B2A4A', marginBottom: '1rem', fontFamily: 'Georgia, serif' }}>{deck.pocTitle}</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                                  {deck.phases.map((p, i) => {
                                    const weekColors = ['#2E75B6', '#1B2A4A', '#C0392B']
                                    return (
                                      <div key={i} style={{ background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
                                        <div style={{ background: weekColors[i], padding: '0.5rem 0.75rem' }}>
                                          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{p.week}</div>
                                          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>{p.title}</div>
                                        </div>
                                        <div style={{ padding: '0.5rem 0.75rem' }}>
                                          {p.items.map((item, j) => (
                                            <div key={j} style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', marginBottom: '0.35rem' }}>
                                              <div style={{ width: 6, height: 6, borderRadius: '50%', background: weekColors[i], marginTop: 4, flexShrink: 0 }} />
                                              <div style={{ fontSize: '0.7rem', color: '#1B2A4A' }}>{item}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                                <div style={{ textAlign: 'center', fontSize: '0.7rem', fontStyle: 'italic', color: '#555', marginTop: '0.75rem' }}>Weeks 1–2 are discovery. Commercial engagement begins at prototype sign-off.</div>
                              </div>

                              {/* Slide 8: Next Steps */}
                              <div style={{ background: '#1B2A4A', borderRadius: 12, padding: '2rem', marginBottom: '1rem', position: 'relative', overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', bottom: 0, left: 0, width: 200, height: 140, background: 'rgba(46,117,182,0.15)', borderRadius: '0 80px 0 12px' }} />
                                <div style={{ fontSize: '0.7rem', color: '#B0BEC5', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>SLIDE 8 OF 8</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginBottom: '1rem' }}>
                                  <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>Intellagentic</span>
                                  <span style={{ fontWeight: 700, color: '#C0392B', fontSize: '0.9rem' }}>XO</span>
                                </div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', marginBottom: '0.75rem', fontFamily: 'Georgia, serif' }}>Next Steps</div>
                                <div style={{ width: 60, height: 3, background: '#C0392B', marginBottom: '1rem' }} />
                                {deck.nextSteps.map((ns, i) => (
                                  <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.6rem' }}>
                                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#C0392B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>{ns.num}</div>
                                    <div style={{ fontSize: '0.85rem', color: '#F0F4F8' }}>{ns.text}</div>
                                  </div>
                                ))}
                                <div style={{ background: '#1A2030', borderRadius: 8, padding: '0.75rem', marginTop: '1rem', borderLeft: '3px solid #27AE60' }}>
                                  <span style={{ fontWeight: 600, color: '#27AE60', fontSize: '0.8rem' }}>Success Metric: </span>
                                  <span style={{ color: '#F0F4F8', fontSize: '0.8rem' }}>{deck.successMetric}</span>
                                </div>
                                <div style={{ background: '#E8F4F8', borderRadius: 6, padding: '0.4rem', textAlign: 'center', marginTop: '0.75rem' }}>
                                  <span style={{ fontSize: '0.7rem', fontStyle: 'italic', color: '#2E75B6' }}>XO is priced against the cost of the problem, not the cost of the technology.</span>
                                </div>
                                <div style={{ fontSize: '0.7rem', color: '#B0BEC5', marginTop: '0.5rem' }}>alan.moore@intellagentic.io  ·  ken.scott@intellagentic.io</div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                              <Package size={32} style={{ margin: '0 auto 0.75rem', opacity: 0.5 }} />
                              <p style={{ fontSize: '0.9rem' }}>Growth Deck not available for this analysis.</p>
                              <p style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>Re-run enrichment to generate a Growth Deck.</p>
                            </div>
                          )})()}
                        </div>:
                        <div></div>))))))
                  }
                </div>
            )}
          </div>
        }
        )}
      </div>


      {/* Client Summary */}
      {/*displayResults.client_summary && (
        <div className="panel" style={{ border: '2px solid #dc2626', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{
            background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
            padding: '1rem 1.25rem',
            display: 'flex', alignItems: 'center', gap: '0.625rem'
          }}>
            <Star size={20} style={{ color: '#ffffff' }} />
            <h2 style={{ color: '#ffffff', margin: 0, fontSize: '1rem', fontWeight: 700, letterSpacing: '0.02em' }}>XO Summary for Client</h2>
          </div>
          <div style={{ padding: '1.5rem', background: 'var(--bg-primary)' }}>
            {displayResults.client_summary.split('\n').filter(line => line.trim()).map((line, idx) => {
              const trimmed = line.trim()
              if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                return (
                  <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.75rem', paddingLeft: '0.5rem' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#dc2626', marginTop: '0.5rem', flexShrink: 0 }} />
                    <p style={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text-primary)', margin: 0 }}>
                      {trimmed.substring(2)}
                    </p>
                  </div>
                )
              }
              return (
                <p key={idx} style={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                  {trimmed}
                </p>
              )
            })}
          </div>
        </div>
      )*/}

      {/* Streamline Applications */}
      {/*displayResults.streamline_applications && (
        <div className="panel" style={{ border: '2px solid #4b5563', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{
            background: '#1a1a1a',
            padding: '1rem 1.25rem',
            display: 'flex', alignItems: 'center', gap: '0.625rem'
          }}>
            <img src={intellistackLogo} alt="Intellistack" style={{ height: '22px' }} />
            <h2 style={{ color: '#ffffff', margin: 0, fontSize: '1rem', fontWeight: 700, letterSpacing: '0.02em' }}>Potential Streamline Applications</h2>
          </div>
          <div style={{ padding: '1.5rem', background: 'var(--bg-primary)' }}>
            {displayResults.streamline_applications.split('\n').filter(line => line.trim()).map((line, idx) => {
              const trimmed = line.trim()
              // Bold headers like **1. Title**
              const boldMatch = trimmed.match(/^\*\*(.+)\*\*$/)
              if (boldMatch) {
                return (
                  <h3 key={idx} style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', margin: idx === 0 ? '0 0 0.5rem 0' : '1.25rem 0 0.5rem 0' }}>
                    {boldMatch[1]}
                  </h3>
                )
              }
              // Labeled lines like "Problem: ...", "Workflow: ...", "Integrations: ...", "Outcome: ..."
              const labelMatch = trimmed.match(/^(Problem|Workflow|Integrations|Outcome):\s*(.+)/)
              if (labelMatch) {
                return (
                  <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.35rem', paddingLeft: '0.75rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: labelMatch[1] === 'Problem' ? '#ef4444' : labelMatch[1] === 'Workflow' ? '#3b82f6' : '#6b7280', minWidth: '90px', flexShrink: 0 }}>{labelMatch[1]}:</span>
                    <span style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>{labelMatch[2]}</span>
                  </div>
                )
              }
              // Bullet points
              if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                return (
                  <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '0.5rem', paddingLeft: '0.5rem' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4b5563', marginTop: '0.5rem', flexShrink: 0 }} />
                    <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-primary)', margin: 0 }}>{trimmed.substring(2)}</p>
                  </div>
                )
              }
              // Regular paragraphs
              return (
                <p key={idx} style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
                  {trimmed}
                </p>
              )
            })}
          </div>
        </div>
      )*/}

      {/* Executive Summary */}
      {/*<div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <TrendingUp size={20} className="icon-red" />
            <h2>Executive Summary</h2>
          </div>
        </div>
        <div style={{ padding: '1.25rem' }}>
          <p style={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text-primary)' }}>
            {displayResults.summary}
          </p>
        </div>
      </div>*/}

      {/* Bottom Line */}
      {/*displayResults.bottom_line && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-header-left">
              <Zap size={20} className="icon-red" />
              <h2>Bottom Line</h2>
            </div>
          </div>
          <div style={{ padding: '1.25rem' }}>
            <div style={{
              background: 'rgba(220, 38, 38, 0.05)',
              border: '1px solid rgba(220, 38, 38, 0.15)',
              borderLeft: '4px solid #dc2626',
              borderRadius: '8px',
              padding: '1rem 1.25rem'
            }}>
              <p style={{ fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>
                {displayResults.bottom_line}
              </p>
            </div>
          </div>
        </div>
      )*/}

      {/* Problems Identified */}
      {/*<div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <AlertTriangle size={20} className="icon-red" />
            <h2>Problems Identified</h2>
            <span className="badge-count red">{displayResults.problems?.length || 0}</span>
          </div>
        </div>
        <div style={{ padding: '1.25rem', display: 'grid', gap: '0.75rem' }}>
          {displayResults.problems?.map((problem, index) => (
            <div
              key={index}
              style={{
                border: `1px solid ${getSeverityColor(problem.severity)}20`,
                borderLeft: `4px solid ${getSeverityColor(problem.severity)}`,
                borderRadius: '10px',
                background: 'var(--bg-card-alt)',
                overflow: 'hidden'
              }}
            >
              <div
                onClick={() => toggleProblem(index)}
                style={{
                  padding: '1rem 1.25rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem'
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                      {problem.title}
                    </h3>
                    <span style={{
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      background: getSeverityBg(problem.severity),
                      color: getSeverityColor(problem.severity),
                      textTransform: 'uppercase'
                    }}>
                      {problem.severity}
                    </span>
                  </div>
                </div>
                {expandedProblems[index] ? (
                  <ChevronDown size={20} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                ) : (
                  <ChevronRight size={20} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                )}
              </div>
              {expandedProblems[index] && (
                <div style={{
                  padding: '0 1.25rem 1rem',
                  borderTop: '1px solid #e5e5e5'
                }}>
                  <div style={{ marginTop: '1rem' }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                      Evidence
                    </p>
                    <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-primary)', marginBottom: '1rem' }}>
                      {problem.evidence}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                      Recommendation
                    </p>
                    <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>
                      {problem.recommendation}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>*/}

      {/* Proposed Architecture */}
      {/*displayResults.architecture_diagram && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-header-left">
              <Package size={20} className="icon-red" />
              <h2>Proposed Architecture</h2>
            </div>
          </div>
          <div style={{ padding: '1.25rem' }}>
            <pre style={{
              background: 'var(--bg-card-alt)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '1.25rem',
              fontSize: '0.75rem',
              lineHeight: 1.5,
              fontFamily: 'Monaco, Menlo, Consolas, monospace',
              color: 'var(--text-primary)',
              overflowX: 'auto',
              margin: 0,
              whiteSpace: 'pre'
            }}>
              {displayResults.architecture_diagram}
            </pre>
          </div>
        </div>
      )*/}

      {/* Proposed Schema */}
      {/*<div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <Database size={20} className="icon-red" />
            <h2>Proposed Data Schema</h2>
            <span className="badge-count blue">{displayResults.schema?.tables?.length || 0} Tables</span>
          </div>
        </div>
        <div style={{ padding: '1.25rem', display: 'grid', gap: '0.75rem' }}>
          {displayResults.schema?.tables?.map((table, index) => (
            <div
              key={index}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                background: 'var(--bg-card-alt)',
                overflow: 'hidden'
              }}
            >
              <div
                onClick={() => toggleTable(table.name)}
                style={{
                  padding: '1rem 1.25rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem'
                }}
              >
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                    {table.name}
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                    {table.purpose}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className="badge-count blue">{table.columns?.length || 0} columns</span>
                  {expandedTables[table.name] ? (
                    <ChevronDown size={20} style={{ color: 'var(--text-secondary)' }} />
                  ) : (
                    <ChevronRight size={20} style={{ color: 'var(--text-secondary)' }} />
                  )}
                </div>
              </div>
              {expandedTables[table.name] && (
                <div style={{
                  padding: '0 1.25rem 1rem',
                  borderTop: '1px solid #e5e5e5'
                }}>
                  <div style={{ marginTop: '1rem' }}>
                    <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #e5e5e5' }}>
                          <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Column</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Type</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.columns?.map((col, colIndex) => (
                          <tr key={colIndex} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '0.625rem 0.5rem', fontWeight: 500, color: 'var(--text-primary)' }}>{col.name}</td>
                            <td style={{ padding: '0.625rem 0.5rem', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.75rem' }}>{col.type}</td>
                            <td style={{ padding: '0.625rem 0.5rem', color: 'var(--text-secondary)' }}>{col.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))*/}
          {/* Schema Relationships */}
          {/*displayResults.schema?.relationships?.length > 0 && (
            <div style={{
              marginTop: '0.25rem',
              padding: '0.75rem 1rem',
              background: 'var(--bg-card-alt)',
              borderRadius: '8px',
              border: '1px solid var(--border-color)'
            }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                Relationships
              </p>
              {displayResults.schema.relationships.map((rel, i) => (
                <p key={i} style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-primary)',
                  fontFamily: 'Monaco, Menlo, Consolas, monospace',
                  margin: '0.25rem 0',
                  lineHeight: 1.5
                }}>
                  {rel}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>*/}

      {/* 7/14/21 Day Plan */}
      {/*<div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <Calendar size={20} className="icon-red" />
            <h2>7/14/21 Day Action Plan</h2>
          </div>
        </div>
        <div style={{ padding: '1.25rem', display: 'grid', gap: '1rem' }}>
          {displayResults.plan?.map((phase, index) => (
            <div
              key={index}
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '10px',
                background: 'var(--bg-card-alt)',
                padding: '1rem 1.25rem'
              }}
            >
              <h3 style={{
                fontSize: '0.9rem',
                fontWeight: 700,
                color: '#dc2626',
                marginBottom: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                {phase.phase}
              </h3>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '0.5rem' }}>
                {phase.actions?.map((action, actionIndex) => (
                  <li key={actionIndex} style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>
                    {action}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>*/}

      {/* Sources */}
      {/*<div className="panel">
        <div className="panel-header">
          <div className="panel-header-left">
            <Globe size={20} className="icon-red" />
            <h2>Data Sources</h2>
            <span className="badge-count">{displayResults.sources?.length || 0}</span>
          </div>
        </div>
        <div style={{ padding: '1.25rem' }}>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {displayResults.sources?.map((source, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem',
                  background: 'var(--bg-card-alt)',
                  borderRadius: '8px',
                  fontSize: '0.85rem'
                }}
              >
                <span style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  background: source.type === 'client_data' ? 'rgba(220, 38, 38, 0.1)' : source.type === 'web_enrichment' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(107, 114, 128, 0.1)',
                  color: source.type === 'client_data' ? '#dc2626' : source.type === 'web_enrichment' ? '#3b82f6' : '#6b7280',
                  textTransform: 'uppercase'
                }}>
                  {source.type.replace('_', ' ')}
                </span>
                <span style={{ color: 'var(--text-primary)' }}>{source.reference}</span>
              </div>
            ))}
          </div>
        </div>
      </div>*/}

      {/* Review & Correct Modal */}
      {showReviewModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => { setShowReviewModal(null); setReviewText(''); setReviewStatus(null) }} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: 'var(--bg-card, #fff)', borderRadius: 16, padding: '1.5rem', width: '90%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>Review & Correct — {showReviewModal === 'deck' ? 'Growth Deck' : 'Deployment Brief'}</h3>
              <button onClick={() => { setShowReviewModal(null); setReviewText(''); setReviewStatus(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {reviewStatus === 'saved' ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <CheckCircle size={40} style={{ color: '#22c55e', margin: '0 auto 0.75rem' }} />
                <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600 }}>Corrections saved to Your Data</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Re-enrich to update results.</p>
              </div>
            ) : reviewStatus === 'approved' ? (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <CheckCircle size={40} style={{ color: '#22c55e', margin: '0 auto 0.75rem' }} />
                <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600 }}>Approved — DRAFT watermark removed</p>
              </div>
            ) : (
              <>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Add factual corrections below. They will be saved as a data source and included in the next enrichment.
                </p>
                <textarea
                  value={reviewText}
                  onChange={e => setReviewText(e.target.value)}
                  rows={6}
                  placeholder="Enter factual corrections — e.g., incorrect job titles, company details, or outdated figures"
                  style={{
                    width: '100%', padding: '0.625rem', border: '1px solid var(--border-color)',
                    borderRadius: 8, fontSize: '0.85rem', fontFamily: 'inherit', color: 'var(--text-primary)',
                    background: 'var(--bg-input, #fff)', resize: 'vertical', outline: 'none', marginBottom: '1rem'
                  }}
                />
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button onClick={handleSaveCorrections} disabled={reviewSaving || !reviewText.trim()}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 1rem', background: reviewText.trim() ? '#f59e0b' : '#e5e7eb', color: reviewText.trim() ? '#fff' : '#9ca3af', border: 'none', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: reviewText.trim() && !reviewSaving ? 'pointer' : 'not-allowed' }}>
                    {reviewSaving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />} Submit Corrections
                  </button>
                  <button onClick={() => handleApprove(showReviewModal)} disabled={briefApproveLoading || deckApproveLoading}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.5rem 1rem', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: (briefApproveLoading || deckApproveLoading) ? 'wait' : 'pointer' }}>
                    {(briefApproveLoading || deckApproveLoading) ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={14} />} Approve
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Scope POC Modal */}
      {showScopeModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={() => setShowScopeModal(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ position: 'relative', background: 'var(--bg-card, #fff)', borderRadius: 16, padding: '1.5rem', width: '90%', maxWidth: 520, maxHeight: '80vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Scope POC -- 21-Day Build</h3>
              <button onClick={() => setShowScopeModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem' }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '1rem' }}>Select which problems and new components to include in the POC. Unselected items become Phase 2 candidates (data model only, no features).</p>

            {/* Problems */}
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>Problems</div>
            {(displayResults?.problems || []).map((p, i) => {
              const id = slugifyProblem(p.title)
              const checked = scopeProblems.has(id)
              return (
                <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.4rem 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={checked} onChange={() => {
                    setScopeProblems(prev => { const next = new Set(prev); checked ? next.delete(id) : next.add(id); return next })
                  }} style={{ marginTop: 2, accentColor: '#0F969C' }} />
                  <div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>{p.title}</span>
                    <span style={{ fontSize: '0.65rem', marginLeft: '0.4rem', padding: '0.1rem 0.3rem', borderRadius: 3, background: p.severity === 'high' ? '#fef2f2' : p.severity === 'medium' ? '#fffbeb' : '#f0fdf4', color: p.severity === 'high' ? '#dc2626' : p.severity === 'medium' ? '#d97706' : '#22c55e', fontWeight: 600 }}>{(p.severity || '').toUpperCase()}</span>
                  </div>
                </label>
              )
            })}

            {/* New Components */}
            {displayResults?.component_mapping?.new_components?.length > 0 && (
              <>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '1rem', marginBottom: '0.5rem' }}>New Components</div>
                {displayResults.component_mapping.new_components.map((n, i) => {
                  const checked = scopeComponents.has(n.proposed_name)
                  return (
                    <label key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.4rem 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={checked} onChange={() => {
                        setScopeComponents(prev => { const next = new Set(prev); checked ? next.delete(n.proposed_name) : next.add(n.proposed_name); return next })
                      }} style={{ marginTop: 2, accentColor: '#0F969C' }} />
                      <div>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{n.proposed_name}</span>
                        <span style={{ fontSize: '0.75rem', color: '#6b7280', marginLeft: '0.35rem' }}>{n.purpose}</span>
                      </div>
                    </label>
                  )
                })}
              </>
            )}

            {!activeEngagement?.id && (
              <p style={{ fontSize: '0.75rem', color: '#d97706', fontStyle: 'italic', marginTop: '0.75rem' }}>Select an engagement before scoping.</p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
              <button onClick={() => setShowScopeModal(false)} style={{ padding: '0.5rem 1rem', background: 'none', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: '0.8rem', cursor: 'pointer', color: 'var(--text-primary)' }}>Cancel</button>
              <button onClick={savePocScope} disabled={scopeSaving || !activeEngagement?.id} style={{ padding: '0.5rem 1rem', background: activeEngagement?.id ? '#0F969C' : '#d1d5db', color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: (scopeSaving || !activeEngagement?.id) ? 'not-allowed' : 'pointer' }}>
                {scopeSaving ? 'Saving...' : 'Save Scope'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}


// ============================================================
// SALESFORCE CONFLICTS SCREEN (PR 4)
// Lists unresolved conflicts from salesforce_sync_log scoped to the
// user's account. Each row expands to show per-field xo/sf diffs.
// Resolve buttons hit POST /salesforce/conflicts/{log_id}/resolve.
// ============================================================
function SalesforceConflictsScreen({ apiBase, getAuthHeaders, onResolved }) {
  const [conflicts, setConflicts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState({})
  const [resolving, setResolving] = useState({})
  const [error, setError] = useState(null)

  const fetchConflicts = () => {
    setLoading(true)
    fetch(`${apiBase}/salesforce/conflicts`, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => setConflicts(d.conflicts || []))
      .catch(err => setError(typeof err === 'string' ? err : 'Failed to load conflicts'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchConflicts() }, [])

  const resolve = async (logId, resolution) => {
    setResolving(s => ({ ...s, [logId]: resolution }))
    try {
      const res = await fetch(`${apiBase}/salesforce/conflicts/${logId}/resolve`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ resolution }),
      })
      const data = await res.json()
      if (res.ok) {
        setConflicts(cs => cs.filter(c => c.id !== logId))
        if (onResolved) onResolved()
      } else {
        alert(data.error || 'Resolve failed')
      }
    } catch (err) {
      alert('Resolve failed: ' + err.message)
    }
    setResolving(s => {
      const next = { ...s }
      delete next[logId]
      return next
    })
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 980, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Salesforce Conflicts
      </h1>
      <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Rows where XO and Salesforce both changed the same field since the last sync.
        Choose to keep XO's values (pushed back to SF) or take SF's values (pulled into XO).
      </p>

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted, #6b7280)' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading...
        </div>
      )}

      {!loading && error && (
        <div style={{ padding: '1rem', background: '#fef2f2', color: '#991b1b', border: '1px solid #dc2626', borderRadius: 8 }}>
          {error}
        </div>
      )}

      {!loading && !error && conflicts.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', background: '#f0fdf4', color: '#166534', border: '1px solid #22c55e', borderRadius: 8 }}>
          <CheckCircle size={24} style={{ marginBottom: '0.5rem' }} />
          <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>No unresolved conflicts.</div>
        </div>
      )}

      {!loading && !error && conflicts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {conflicts.map(c => {
            const isOpen = !!expanded[c.id]
            const r = resolving[c.id]
            return (
              <div key={c.id} style={{
                border: '1px solid var(--border-color, #e5e7eb)',
                borderRadius: 10,
                background: 'var(--card-bg, #fff)',
                overflow: 'hidden',
              }}>
                <button
                  onClick={() => setExpanded(s => ({ ...s, [c.id]: !isOpen }))}
                  style={{
                    width: '100%', textAlign: 'left', cursor: 'pointer',
                    background: 'transparent', border: 'none', padding: '1rem',
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    color: 'var(--text-primary, #111)',
                  }}
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>
                      {c.record_label || `(unnamed ${c.record_type})`}
                      <span style={{
                        marginLeft: '0.75rem',
                        fontSize: '0.7rem', fontWeight: 500,
                        padding: '0.15rem 0.5rem', borderRadius: 8,
                        background: 'rgba(220, 38, 38, 0.1)', color: '#dc2626',
                      }}>
                        {c.record_type}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #6b7280)', marginTop: 2 }}>
                      {(c.fields_skipped || []).length} conflicting{' '}
                      {c.record_type === 'client' && (c.fields_skipped || []).some(f => /@/.test(f))
                        ? 'contact(s)' : 'field(s)'}
                      {c.synced_at && (
                        <> · {new Date(c.synced_at).toLocaleString()}</>
                      )}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div style={{ padding: '0 1rem 1rem 2.5rem', borderTop: '1px solid var(--border-color, #e5e7eb)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginTop: '0.75rem' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--text-muted, #6b7280)' }}>
                          {c.record_type === 'client' && c.details?.[0]?.email && (
                            <th style={{ padding: '0.4rem 0.75rem 0.4rem 0' }}>Contact</th>
                          )}
                          <th style={{ padding: '0.4rem 0.75rem 0.4rem 0' }}>Field</th>
                          <th style={{ padding: '0.4rem 0.75rem 0.4rem 0' }}>XO value</th>
                          <th style={{ padding: '0.4rem 0' }}>SF value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(c.details || []).map((d, i) => (
                          <tr key={i} style={{ borderTop: '1px solid var(--border-color, #e5e7eb)' }}>
                            {c.record_type === 'client' && c.details?.[0]?.email && (
                              <td style={{ padding: '0.4rem 0.75rem 0.4rem 0', fontFamily: 'monospace' }}>{d.email || ''}</td>
                            )}
                            <td style={{ padding: '0.4rem 0.75rem 0.4rem 0', fontWeight: 500 }}>{d.field || ''}</td>
                            <td style={{ padding: '0.4rem 0.75rem 0.4rem 0', color: '#0F969C' }}>
                              {d.xo_value !== undefined && d.xo_value !== null ? String(d.xo_value) : '—'}
                            </td>
                            <td style={{ padding: '0.4rem 0', color: '#00a1e0' }}>
                              {d.sf_value !== undefined && d.sf_value !== null ? String(d.sf_value) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                      <button
                        onClick={() => resolve(c.id, 'keep_xo')}
                        disabled={!!r}
                        style={{
                          padding: '0.5rem 1rem', background: '#0F969C', color: '#fff',
                          border: 'none', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                          cursor: r ? 'wait' : 'pointer', opacity: r ? 0.7 : 1,
                        }}
                      >
                        {r === 'keep_xo' ? 'Pushing to SF...' : 'Keep XO (push to SF)'}
                      </button>
                      <button
                        onClick={() => resolve(c.id, 'take_sf')}
                        disabled={!!r}
                        style={{
                          padding: '0.5rem 1rem', background: '#00a1e0', color: '#fff',
                          border: 'none', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600,
                          cursor: r ? 'wait' : 'pointer', opacity: r ? 0.7 : 1,
                        }}
                      >
                        {r === 'take_sf' ? 'Pulling from SF...' : 'Take SF (pull into XO)'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


// ============================================================
// SALESFORCE SHARE-CLIENT MODAL (PR 4)
// Triggered from client list / detail. Grants account-level share via
// POST /clients/{id}/shares. Lists current grants with Revoke.
// Recipient picker: super_admin sees full /accounts list; non-super
// admins see no picker (per Ken's 1A: Monday workflow has super_admin
// doing the share TO Intellistack).
// ============================================================
function ShareClientModal({ apiBase, getAuthHeaders, clientId, clientName, isSuperAdmin, onClose }) {
  const [accounts, setAccounts] = useState([])
  const [shares, setShares] = useState([])
  const [loading, setLoading] = useState(true)
  const [granting, setGranting] = useState(false)
  const [recipient, setRecipient] = useState('')
  const [permissions, setPermissions] = useState('read_write')
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  const refresh = () => {
    setLoading(true)
    Promise.all([
      isSuperAdmin
        ? fetch(`${apiBase}/accounts`, { headers: getAuthHeaders() })
            .then(r => r.ok ? r.json() : { accounts: [] })
            .catch(() => ({ accounts: [] }))
        : Promise.resolve({ accounts: [] }),
      fetch(`${apiBase}/clients/${clientId}/shares`, { headers: getAuthHeaders() })
        .then(r => r.ok ? r.json() : { shares: [] })
        .catch(() => ({ shares: [] })),
    ])
      .then(([aRes, sRes]) => {
        setAccounts(aRes.accounts || aRes || [])
        setShares(sRes.shares || [])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [clientId])

  const grant = async () => {
    if (!recipient) {
      setError('Pick an account to share with.')
      return
    }
    setGranting(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/clients/${clientId}/shares`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          account_id: parseInt(recipient, 10),
          permissions,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setToast(`Shared with ${accounts.find(a => String(a.id) === String(recipient))?.name || 'account'}`)
        setTimeout(() => setToast(null), 4000)
        setRecipient('')
        refresh()
      } else {
        setError(data.error || 'Grant failed')
      }
    } catch (err) {
      setError('Grant failed: ' + err.message)
    }
    setGranting(false)
  }

  const revoke = async (recipientAccountId) => {
    if (!confirm('Revoke this share?')) return
    try {
      const res = await fetch(`${apiBase}/clients/${clientId}/shares/${recipientAccountId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })
      if (res.ok) {
        refresh()
        setToast('Revoked')
        setTimeout(() => setToast(null), 4000)
      } else {
        const data = await res.json()
        alert(data.error || 'Revoke failed')
      }
    } catch (err) {
      alert('Revoke failed: ' + err.message)
    }
  }

  // Filter the accounts dropdown to exclude already-shared accounts.
  const sharedIds = new Set(shares.map(s => s.shared_with_account_id))
  const availableAccounts = accounts.filter(a => !sharedIds.has(a.id))

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: '1rem',
    }}>
      <div style={{
        background: 'var(--card-bg, #fff)',
        borderRadius: 12, padding: 0,
        maxWidth: 560, width: '100%', maxHeight: '85vh',
        overflowY: 'auto', boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
      }}>
        <div style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--border-color, #e5e7eb)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>
            <Share2 size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
            Share {clientName || 'client'}
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted, #6b7280)', padding: '0.25rem',
          }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '1.25rem' }}>
          {!isSuperAdmin && (
            <div style={{
              padding: '0.75rem 1rem', marginBottom: '1rem',
              background: '#fefce8', color: '#854d0e', borderRadius: 8,
              border: '1px solid #eab308', fontSize: '0.8rem',
            }}>
              You're not a super admin — only super admins can grant new shares
              in this UI. Existing shares for this client are listed below.
            </div>
          )}

          {isSuperAdmin && (
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #6b7280)', textTransform: 'uppercase' }}>
                Share with account
              </label>
              <select
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                style={{
                  width: '100%', marginTop: '0.4rem', padding: '0.5rem',
                  border: '1px solid var(--border-color, #e5e7eb)', borderRadius: 8,
                  fontSize: '0.875rem', background: 'var(--card-bg, #fff)',
                  color: 'var(--text-primary, #111)',
                }}
                disabled={loading || granting}
              >
                <option value="">— Pick an account —</option>
                {availableAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>

              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted, #6b7280)', textTransform: 'uppercase', display: 'block', marginTop: '1rem' }}>
                Permissions
              </label>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="radio" name="perm" value="read_write" checked={permissions === 'read_write'} onChange={() => setPermissions('read_write')} />
                  Read &amp; write
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input type="radio" name="perm" value="read_only" checked={permissions === 'read_only'} onChange={() => setPermissions('read_only')} />
                  Read only
                </label>
              </div>

              {error && (
                <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#fef2f2', color: '#991b1b', borderRadius: 8, fontSize: '0.8rem' }}>
                  {error}
                </div>
              )}

              <button
                onClick={grant}
                disabled={!recipient || granting}
                style={{
                  marginTop: '1rem',
                  padding: '0.625rem 1.25rem',
                  background: recipient ? '#0F969C' : '#cbd5e1', color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: '0.85rem', fontWeight: 600,
                  cursor: (recipient && !granting) ? 'pointer' : 'not-allowed',
                }}
              >
                {granting ? 'Sharing...' : 'Share'}
              </button>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border-color, #e5e7eb)', paddingTop: '1rem' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-primary, #111)' }}>
              Current shares
            </h3>
            {loading && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)' }}>Loading...</p>
            )}
            {!loading && shares.length === 0 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #6b7280)' }}>
                No shares yet.
              </p>
            )}
            {!loading && shares.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {shares.map(s => {
                  const acctName = accounts.find(a => a.id === s.shared_with_account_id)?.name || `Account #${s.shared_with_account_id}`
                  return (
                    <div key={s.shared_with_account_id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.6rem 0.8rem',
                      background: 'var(--bg-secondary, #f9fafb)',
                      borderRadius: 8, border: '1px solid var(--border-color, #e5e7eb)',
                    }}>
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{acctName}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #6b7280)' }}>
                          {s.permissions === 'read_write' ? 'Read &amp; write' : 'Read only'}
                          {s.granted_at && <> · granted {new Date(s.granted_at).toLocaleDateString()}</>}
                        </div>
                      </div>
                      <button
                        onClick={() => revoke(s.shared_with_account_id)}
                        style={{
                          padding: '0.3rem 0.6rem',
                          background: 'transparent', color: '#dc2626',
                          border: '1px solid #dc2626', borderRadius: 6,
                          fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        Revoke
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {toast && (
            <div style={{
              marginTop: '1rem', padding: '0.5rem 0.75rem',
              background: '#f0fdf4', color: '#166534', borderRadius: 8,
              border: '1px solid #22c55e', fontSize: '0.8rem',
            }}>
              <CheckCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              {toast}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
