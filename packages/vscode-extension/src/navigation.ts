import * as vscode from 'vscode';
import { DetailTreeProvider } from './providers/detailProvider';

/**
 * The context key that decides which of the two views exists.
 *
 * Both are contributed to the same container with complementary `when`
 * clauses, so exactly one is present at any moment. This is the whole
 * mechanism behind the index/detail split - there is no third state and no
 * way for both to be on screen at once, which was the thing SABIN-0022 set
 * out to remove.
 */
export const DETAIL_CONTEXT = 'sabin.detail';

export const INDEX_VIEW = 'sabin.indexView';
export const DETAIL_VIEW = 'sabin.detailView';
export const CONTAINER = 'workbench.view.extension.sabin';

export class Navigator {
  private ticket: string | null = null;

  constructor(private readonly detail: DetailTreeProvider) {}

  /**
   * The ticket the detail view is on, kept across a trip back to the index so
   * that ⌥⌘P and friends still know what you were last looking at
   */
  public current(): string | undefined {
    return this.ticket ?? undefined;
  }

  public async showIndex(): Promise<void> {
    await vscode.commands.executeCommand('setContext', DETAIL_CONTEXT, false);
    await vscode.commands.executeCommand(`${INDEX_VIEW}.focus`);
  }

  public async showDetail(ticket: string): Promise<void> {
    this.ticket = ticket;
    await this.detail.setTicket(ticket);

    // Order matters: `.focus` on a view whose `when` is false is a silent
    // no-op, so the key has to flip before the view can be revealed
    await vscode.commands.executeCommand('setContext', DETAIL_CONTEXT, true);
    await vscode.commands.executeCommand(`${DETAIL_VIEW}.focus`);
  }
}
