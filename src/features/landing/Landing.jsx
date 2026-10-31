import { Link } from 'react-router-dom';
import { useCtx } from '../../app/AuthProvider';
import './landing.css';

const CONTACT = import.meta.env.VITE_CONTACT_EMAIL;

function Icon({ children }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const FEATURES = [
  {
    title: 'Attendance in a few taps',
    text: 'Teachers open their class, mark Present, Absent or Leave, and save. Students see their own percentage the same day.',
    icon: <path d="M20 6 9 17l-5-5" />,
  },
  {
    title: 'A timetable that cannot clash',
    text: 'A room, a teacher or a section can only be in one place per period. A double booking is refused when you save it.',
    icon: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  },
  {
    title: 'Exams and results you can trust',
    text: 'Results stay hidden until you publish. Publishing waits for every mark, so nobody sees a half-finished result.',
    icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  },
  {
    title: 'Class materials in one place',
    text: 'Teachers share notes with the class they teach. Only students enrolled in that class can open them.',
    icon: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
  },
  {
    title: 'Every college kept apart',
    text: 'Many colleges can use the same system and never see each other. Each one has its own students, staff and records.',
    icon: <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01" /></>,
  },
  {
    title: 'A record of every change',
    text: 'When a mark or an attendance entry is corrected, the system keeps who changed it, and from what to what.',
    icon: <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />,
  },
];

const STEPS = [
  ['Set up your college', 'Add departments, courses, subjects, sections, teachers and students once.'],
  ['Teachers do the daily work', 'They mark attendance, enter marks and share notes, only for the classes they teach.'],
  ['Everyone sees what is theirs', 'Students check their attendance and published results. Admins see the whole college.'],
];

const ROLES = [
  ['College admins', 'Run the college: people, classes, timetable, exams, announcements and reports.'],
  ['Faculty', 'Open their classes, mark attendance, enter marks and upload notes. Nothing else.'],
  ['Students', 'See their own timetable, attendance, class notes and results once published.'],
];

const TRUST = [
  'Students see only their own records.',
  'Teachers can change only the classes they teach.',
  'Results are hidden until an admin publishes them.',
  'Every correction to attendance or marks is logged.',
];

function Register() {
  const rows = [['Aarav', 'P'], ['Diya', 'P'], ['Kabir', 'A'], ['Meera', 'L']];
  return (
    <div className="lp-mock" role="img" aria-label="Illustration: a class attendance register and a published result card, with sample data">
      <div className="lp-card lp-register" aria-hidden="true">
        <div className="lp-card-head">
          <strong>Mathematics</strong>
          <span>Section A · Period 2</span>
        </div>
        {rows.map(([name, status]) => (
          <div className="lp-row" key={name}>
            <span className="lp-avatar">{name[0]}</span>
            <span className="lp-name">{name}</span>
            <span className={`lp-chip lp-${status}`}>{{ P: 'Present', A: 'Absent', L: 'Leave' }[status]}</span>
          </div>
        ))}
        <div className="lp-save">Save attendance</div>
      </div>
      <div className="lp-card lp-result" aria-hidden="true">
        <span className="lp-pill">Published</span>
        <div className="lp-big">78%</div>
        <div className="lp-small">Mid-term · Pass</div>
        <div className="lp-bar"><span /></div>
      </div>
      <p className="lp-sample" aria-hidden="true">Sample data</p>
    </div>
  );
}

export default function Landing() {
  const ctx = useCtx();
  const [to, label] = ctx?.user && ctx?.profile ? ['/dashboard', 'Open dashboard'] : ['/login', 'Sign in'];
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">Skip to content</a>
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <Link to="/" className="lp-brand"><span className="lp-logo" aria-hidden="true">T</span> Techomato College ERP</Link>
          <nav aria-label="Page sections" className="lp-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#roles">Who it is for</a>
          </nav>
          <Link to={to} className="lp-btn lp-btn-solid lp-btn-sm">{label}</Link>
        </div>
      </header>

      <main id="main">
        <section className="lp-hero">
          <div className="lp-wrap lp-hero-in">
            <div className="lp-copy">
              <p className="lp-eyebrow">College management, without the spreadsheets</p>
              <h1>One calm place to run your <em>whole college</em>.</h1>
              <p className="lp-lead">
                Attendance, timetables, exams, results and class notes for every teacher, student and admin. Built to
                replace paper registers and scattered files, and simple enough to use on day one.
              </p>
              <div className="lp-cta">
                <Link to={to} className="lp-btn lp-btn-solid">{ctx?.user && ctx?.profile ? label : 'Sign in to your college'}</Link>
                {CONTACT
                  ? <a href={`mailto:${CONTACT}`} className="lp-btn lp-btn-ghost">Contact us</a>
                  : <a href="#features" className="lp-btn lp-btn-ghost">See what it does</a>}
              </div>
              <ul className="lp-points">
                <li>Works on a phone, tablet or computer</li>
                <li>Each college's data stays separate</li>
              </ul>
            </div>
            <Register />
          </div>
        </section>

        <section id="features" className="lp-section">
          <div className="lp-wrap">
            <h2>Everything a college runs on, in one system</h2>
            <p className="lp-sub">Six things that take the most time every week, done properly.</p>
            <ul className="lp-grid">
              {FEATURES.map((f) => (
                <li className="lp-feature" key={f.title}>
                  <span className="lp-icon"><Icon>{f.icon}</Icon></span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="lp-section lp-tint">
          <div className="lp-wrap">
            <h2>Up and running in three steps</h2>
            <ol className="lp-steps">
              {STEPS.map(([title, text], i) => (
                <li key={title}>
                  <span className="lp-num" aria-hidden="true">{i + 1}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="roles" className="lp-section">
          <div className="lp-wrap">
            <h2>Made for the people who use it every day</h2>
            <ul className="lp-grid lp-grid-3">
              {ROLES.map(([title, text]) => (
                <li className="lp-role" key={title}>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-dark">
          <div className="lp-wrap lp-trust">
            <div>
              <h2>Careful with what matters</h2>
              <p className="lp-sub">Marks and attendance decide real outcomes. The system is built so that mistakes are hard to make and easy to trace.</p>
            </div>
            <ul className="lp-checks">
              {TRUST.map((t) => (
                <li key={t}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section lp-final">
          <div className="lp-wrap">
            <h2>Ready when you are</h2>
            <p className="lp-sub">Your college admin gives you your login. Sign in to get started.</p>
            <div className="lp-cta lp-center">
              <Link to={to} className="lp-btn lp-btn-solid">{label}</Link>
              {CONTACT && <a href={`mailto:${CONTACT}`} className="lp-btn lp-btn-ghost">Contact us</a>}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <span>© {new Date().getFullYear()} Techomato College ERP</span>
          <Link to={to}>{label}</Link>
        </div>
      </footer>
    </div>
  );
}
