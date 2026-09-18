import Link from 'next/link';
import guides from '@jksh/ui/help';
import './help.css';
import { requireAdminActor } from '@/server/auth';

export default async function HelpPage() {
  const actor = await requireAdminActor();
  const guide =
    actor.role === 'central_admin'
      ? guides.central_admin
      : actor.role === 'franchise_owner'
        ? guides.franchise_owner
        : guides.accountant;
  return (
    <main className="user-help">
      <header className="help-heading">
        <div>
          <p className="eyebrow">T VANAMM · HELP & MANUAL</p>
          <h1>{guide.title}</h1>
          <p>{guide.intro}</p>
        </div>
        <Link href="/">Back to workspace →</Link>
      </header>
      <div className="help-layout">
        <nav className="help-contents" aria-label="Guide contents">
          <h2>In this guide</h2>
          {guide.sections.map((section, index) => (
            <a key={section.title} href={`#step-${String(index + 1)}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              {section.title}
            </a>
          ))}
        </nav>
        <div className="help-chapters">
          {guide.sections.map((section, index) => (
            <section className="help-chapter" id={`step-${String(index + 1)}`} key={section.title}>
              <p className="help-number">GUIDE {String(index + 1).padStart(2, '0')}</p>
              <h2>{section.title}</h2>
              <p className="help-location">{section.where}</p>
              <p>{section.purpose}</p>
              <ol>
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              {section.note ? <aside className="help-note">{section.note}</aside> : null}
              <a className="help-top" href="#">
                Back to contents ↑
              </a>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
