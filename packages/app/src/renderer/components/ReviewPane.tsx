import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { RedeResult, TaskSummary, WorkspaceInfo } from '../../shared/types';
import { api } from '../api';
import { useActions } from '../App';
import { Button, Icon } from './bits';

/**
 * Rede's review page, shown in the task view's main area. The page itself
 * is a native view the main process lays over `.review-host`; this component
 * only reports where that box is, and hides the view while a dialog is open
 * (a native view always paints above the page).
 */
export function ReviewPane({ task, workspace, onClose }: { task: TaskSummary; workspace: WorkspaceInfo; onClose(): void }) {
  const actions = useActions();
  const host = useRef<HTMLDivElement>(null);
  const [review, setReview] = useState<RedeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setReview(null);
    setError(null);
    void api.openReview(task.id, workspace.path).then(result => {
      if (stale) return;
      if (result.ok) setReview(result.value);
      else setError(result.error);
    });
    return () => {
      stale = true;
    };
  }, [task.id, workspace.path]);

  useLayoutEffect(() => {
    const element = host.current;
    if (!review || !element) return;
    if (actions.overlay) {
      void api.hideReview();
      return;
    }
    const place = () => {
      const rect = element.getBoundingClientRect();
      void api.showReview(review.url, { x: rect.left, y: rect.top, width: rect.width, height: rect.height }).then(result => {
        if (!result.ok) setError(result.error);
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [review, actions.overlay]);

  useEffect(() => () => void api.hideReview(), []);

  return (
    <div class="review">
      <div class="review-bar">
        <Button kind="plain" class="btn-small" onClick={onClose} title="Back to files (Esc)">
          <Icon name="back" size={12} />
          Files
        </Button>
        <span class="review-what">
          <span class="review-title">{review?.title ?? (error ? 'Review' : 'Opening review…')}</span>
          <span class="review-sub mono">{workspace.repo} · {workspace.branch}</span>
        </span>
        {review && (
          <Button kind="ghost" class="btn-small" onClick={() => void api.openExternal(review.url)} title={review.url}>
            Open in Browser
            <Icon name="external" size={12} />
          </Button>
        )}
      </div>
      {error ? (
        <div class="empty-state review-error">
          <h2>{/not installed/.test(error) ? 'Rede is not installed' : 'Could not open the review'}</h2>
          <p>{error}</p>
          <Button kind="plain" onClick={onClose}>Back to Files</Button>
        </div>
      ) : (
        <div class="review-host" ref={host} data-testid="review-host">
          {!review && <div class="review-loading">Starting Rede…</div>}
        </div>
      )}
    </div>
  );
}
