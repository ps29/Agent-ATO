import { FeedList } from '../components/FeedList';
import { useStore } from '../store';

/** Cross-session live log: every action from every session, newest first. */
export function Feed() {
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const setFollow = useStore((s) => s.setFollow);
  return (
    <div className="card">
      <FeedList
        onOpen={(sessionId, index) => {
          setFollow(false);
          setView('live');
          void select(sessionId, index);
        }}
      />
    </div>
  );
}
