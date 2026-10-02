import { useEffect, useState } from 'react';
import type { HeroDef } from './game/content/heroes';
import { Game, type RunSummary } from './ui/Game';
import { Title, Select, Death, RecordsScreen } from './ui/Screens';
import { loadRecords, saveRun, type Records } from './records';
import { UpdateBanner } from './ui/Update';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { BUILD, BUILD_NAME } from './version';
import { lang, setLang, t } from './i18n';

type Screen = { kind: 'title' } | { kind: 'select' } | { kind: 'records' } | { kind: 'run'; hero: HeroDef; seed: number } | { kind: 'dead'; r: RunSummary; rank: number; heroBest: boolean };

export default function App() {
  return (
    <ErrorBoundary>
      <Screens />
    </ErrorBoundary>
  );
}

function Screens() {
  const [screen, setScreen] = useState<Screen>({ kind: 'title' });
  const [records, setRecords] = useState<Records>(() => loadRecords());
  const [, setLangState] = useState(lang);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen.kind]);

  const start = (hero: HeroDef) => {
    const asked = Number(new URLSearchParams(location.search).get('seed'));
    setScreen({ kind: 'run', hero, seed: asked || (Date.now() ^ (Math.random() * 1e9)) >>> 0 });
  };

  let body;
  switch (screen.kind) {
    case 'title':
      body = (
        <Title
          records={records}
          onPlay={() => setScreen({ kind: 'select' })}
          onRecords={() => setScreen({ kind: 'records' })}
          onLang={(l) => {
            setLang(l);
            setLangState(l);
          }}
        />
      );
      break;
    case 'select':
      body = <Select records={records} onPick={start} onBack={() => setScreen({ kind: 'title' })} />;
      break;
    case 'records':
      body = <RecordsScreen records={records} onBack={() => setScreen({ kind: 'title' })} />;
      break;
    case 'run':
      body = (
        <Game
          key={screen.seed}
          heroes={[screen.hero]}
          seed={screen.seed}
          onQuit={() => setScreen({ kind: 'select' })}
          onRestart={() => start(screen.hero)}
          onEnd={(r) => {
            const best = [...r.guns].sort((a, b) => b.rarity - a.rarity)[0];
            const saved = saveRun({
              hero: r.hero.id,
              floor: r.floor,
              time: r.time,
              kills: r.kills,
              coins: r.coins,
              bestGun: best ? t(best.name) : '',
              bestRarity: r.bestRarity,
              date: new Date().toISOString(),
            });
            setRecords(saved.records);
            setScreen({ kind: 'dead', r, rank: saved.rank, heroBest: saved.heroBest });
          }}
        />
      );
      break;
    case 'dead':
      body = <Death r={screen.r} rank={screen.rank} heroBest={screen.heroBest} onAgain={() => start(screen.r.hero)} onMenu={() => setScreen({ kind: 'select' })} />;
      break;
  }
  return (
    <>
      {body}
      {screen.kind !== 'run' && <UpdateBanner />}
      {screen.kind === 'title' && (
        <div className="build">
          {BUILD_NAME} · {BUILD}
        </div>
      )}
    </>
  );
}
