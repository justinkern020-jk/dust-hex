import { Component, type ReactNode } from 'react';

/**
 * Catches a render error inside a match. Instead of losing the page, it asks
 * the parent to reopen the match from the last saved step (onCrash). After a
 * few crashes in a row it gives up and sends the player to the porch.
 */
export class MatchGuard extends Component<{ children: ReactNode; onCrash: (err: unknown) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    try {
      console.error('[dusthex] match render error, resuming', err);
    } catch {
      /* ignore */
    }
    this.props.onCrash(err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
