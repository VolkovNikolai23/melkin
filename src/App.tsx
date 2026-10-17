import { useEffect, useState } from 'react';
import { DialogHost } from './components/dialog';
import { Home } from './components/Home';
import { Icon } from './components/Icon';
import { SettingsView } from './components/SettingsView';
import { useDueCount } from './components/useDue';
import { DocPage } from './features/notes/DocPage';
import { SearchView } from './features/notes/SearchView';
import { Sidebar } from './features/notes/Sidebar';
import { ReviewView } from './features/review/ReviewView';
import { ReviewHome } from './features/review/ReviewHome';
import { TagPage, TagsView } from './features/links/LinkViews';
import { useKeyboardInset } from './lib/keyboard';
import { useRoute } from './lib/router';

const NARROW = '(max-width: 900px)';

export function App() {
  const route = useRoute();
  const due = useDueCount();
  useKeyboardInset();
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW).matches);
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem('melkin-sidebar');
      return v === null ? !matchMedia(NARROW).matches : v === '1';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const mq = matchMedia(NARROW);
    const on = () => {
      setNarrow(mq.matches);
      if (mq.matches) setOpen(false);
    };
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const toggle = (v: boolean) => {
    setOpen(v);
    try {
      if (!narrow) localStorage.setItem('melkin-sidebar', v ? '1' : '0');
    } catch {
      /* ничего */
    }
  };

  const [name, id] = route.path;
  const routeName = name ?? '';
  const activeId = name === 'doc' ? id : null;

  let view;
  if (name === 'doc' && id) view = <DocPage key={id} id={id} highlight={route.query.get('b')} />;
  else if (name === 'review') view = route.query.get('scope') ? <ReviewView scopeStr={route.query.get('scope')} /> : <ReviewHome />;
  else if (name === 'search') view = <SearchView initial={route.query.get('q') ?? ''} />;
  else if (name === 'settings') view = <SettingsView />;
  else if (name === 'tags') view = <TagsView />;
  else if (name === 'tag' && id) view = <TagPage tag={id} />;
  else view = <Home />;

  // во время сессии повторения боковая панель скрыта, на экране выбора очереди — видна
  const inReview = name === 'review' && !!route.query.get('scope');

  return (
    <div className={'app' + (open ? ' sidebar-open' : '') + (narrow ? ' narrow' : '')}>
      {!inReview && (
        <Sidebar
          activeId={activeId}
          routeName={routeName}
          due={due}
          onNavigate={() => narrow && toggle(false)}
          onCollapse={() => toggle(false)}
        />
      )}
      {narrow && open && !inReview && <div className="scrim" onClick={() => toggle(false)} />}
      <main className="main">
        {!inReview && !open && (
          <button className="icon-btn sidebar-toggle" onClick={() => toggle(true)} aria-label="Показать панель">
            <Icon name="menu" />
            {due && due.total > 0 && <span className="dot-badge" />}
          </button>
        )}
        <div className="main-scroll">{view}</div>
      </main>
      <DialogHost />
    </div>
  );
}
