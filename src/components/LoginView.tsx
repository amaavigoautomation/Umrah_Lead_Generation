import React, { useState } from 'react';
import {
  Lock,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowUpRight,
  Database,
  KeyRound,
  AlertCircle,
  ShieldCheck,
  Sparkles,
  MessageCircle,
  CalendarCheck,
  Check,
  Zap,
} from 'lucide-react';
import { signIn, requestPasswordReset, friendlyAuthError } from '../services/authService';
import './LoginView.css';

interface LoginViewProps {
  isFirebaseActive: boolean;
  initialError?: string | null;
}

const LOGIN_STEPS = [
  { number: '01', label: 'Lead captured', detail: 'Every enquiry starts with context', icon: Sparkles },
  { number: '02', label: 'Conversation moving', detail: 'AI and your team work together', icon: MessageCircle },
  { number: '03', label: 'Next step booked', detail: 'Turn intent into a real meeting', icon: CalendarCheck },
];

export const LoginView: React.FC<LoginViewProps> = ({ isFirebaseActive, initialError }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(initialError || null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // onAuthStateChanged in App takes over after a successful sign-in.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const email = identifier.trim();
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    setIsLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(friendlyAuthError(err));
      setIsLoading(false);
    }
  };

  const handleForgot = async () => {
    setError(null);
    setInfo(null);
    const email = identifier.trim();
    if (!email) {
      setError('Enter your email above first, then click "Forgot password".');
      return;
    }
    try {
      await requestPasswordReset(email);
    } catch {
      // Use the same message either way, so account existence is never disclosed.
    }
    setInfo('If an account exists for that email, a reset link has been sent.');
  };

  return (
    <div className="av-login-root">
      <div className="av-login-ambient av-login-ambient-blue" aria-hidden="true" />
      <div className="av-login-ambient av-login-ambient-orange" aria-hidden="true" />

      <header className="av-login-header">
        <a href="/" className="av-login-brand" aria-label="Amaavigo homepage">
          <img src="/amaavigo-logo.png" alt="Amaavigo" />
          <span className="av-login-brand-divider" />
          <span>AI GROWTH WORKSPACE</span>
        </a>
        <a href="/" className="av-login-back-link">Back to website <ArrowUpRight size={15} /></a>
      </header>

      <main className="av-login-layout">
        <section className="av-login-story">
          <div className="av-login-story-glow" aria-hidden="true" />
          <div className="av-login-story-content">
            <div className="av-login-eyebrow"><i /> YOUR LEAD-TO-REVENUE WORKSPACE</div>
            <h1>Good to have you<br /><span>back in motion.</span></h1>
            <p className="av-login-story-intro">
              Your leads, conversations, campaigns and next steps are all connected.
              Sign in and pick up where your team left off.
            </p>

            <div className="av-login-journey-card">
              <div className="av-login-journey-head">
                <div><small>THE CUSTOMER JOURNEY</small><strong>One connected workflow</strong></div>
                <span className="av-login-live"><i /> WORKSPACE</span>
              </div>
              <div className="av-login-journey-list">
                {LOGIN_STEPS.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <div className="av-login-journey-step" key={step.number}>
                      <span className="av-login-step-number">{step.number}</span>
                      <span className="av-login-step-icon"><Icon size={17} /></span>
                      <span className="av-login-step-copy"><b>{step.label}</b><small>{step.detail}</small></span>
                      <span className="av-login-step-check"><Check size={12} /></span>
                      {index < LOGIN_STEPS.length - 1 && <span className="av-login-step-connector" />}
                    </div>
                  );
                })}
              </div>
              <div className="av-login-journey-foot"><ShieldCheck size={15} /> Keep customer context and team control together.</div>
            </div>

            <div className="av-login-story-foot">
              <span><Zap size={14} /> Less manual follow-up</span>
              <span><Lock size={14} /> Workspace access protected</span>
            </div>
          </div>
        </section>

        <section className="av-login-panel" aria-labelledby="av-login-title">
          <div className="av-login-panel-top">
            <span className="av-login-panel-icon"><KeyRound size={19} /></span>
            <span className="av-login-database-status">
              <i />
              <Database size={13} />
              {isFirebaseActive ? 'Secure connection active' : 'Database ready'}
            </span>
          </div>

          <div className="av-login-panel-heading">
            <small>WORKSPACE ACCESS</small>
            <h2 id="av-login-title">Welcome back.</h2>
            <p>Sign in to continue to your Amaavigo workspace.</p>
          </div>

          {info && (
            <div className="av-login-alert av-login-alert-success" role="status">
              <ShieldCheck size={16} />
              <span>{info}</span>
            </div>
          )}

          {error && (
            <div className="av-login-alert av-login-alert-error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="av-login-form">
            <div className="av-login-field">
              <label htmlFor="av-login-email">Work email</label>
              <div className="av-login-input-wrap">
                <Mail size={17} />
                <input
                  id="av-login-email"
                  type="email"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="you@company.com"
                  required
                />
              </div>
            </div>

            <div className="av-login-field">
              <div className="av-login-label-row">
                <label htmlFor="av-login-password">Password</label>
                <button type="button" onClick={handleForgot} className="av-login-forgot">Forgot password?</button>
              </div>
              <div className="av-login-input-wrap">
                <Lock size={17} />
                <input
                  id="av-login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="av-login-toggle-password"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            <button type="submit" disabled={isLoading} className="av-login-submit">
              {isLoading ? <span>Verifying your access…</span> : <><span>Sign in to workspace</span><ArrowRight size={17} /></>}
            </button>
          </form>

          <div className="av-login-security-note">
            <ShieldCheck size={15} />
            <span>Your workspace access is protected by your organisation’s sign-in settings.</span>
          </div>

          <div className="av-login-legal">
            <a href="/terms">Terms</a><span>·</span>
            <a href="/privacy">Privacy</a><span>·</span>
            <a href="/dpa">DPA</a><span>·</span>
            <a href="/aup">Acceptable Use</a>
          </div>
        </section>
      </main>

      <footer className="av-login-footer">
        <span>© {new Date().getFullYear()} Amaavigo Digital Solutions LLP</span>
        <span>From the first enquiry to the next sales conversation.</span>
      </footer>
    </div>
  );
};
