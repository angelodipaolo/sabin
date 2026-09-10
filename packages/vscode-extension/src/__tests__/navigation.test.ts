import { Navigator } from '../navigation';
import { DetailTreeProvider } from '../providers/detailProvider';

jest.mock('vscode');

/**
 * The ordering here is the whole index/detail mechanism, and it is the kind of
 * thing a later edit tidies into the "obvious" order without noticing: focus
 * first, then flip the key. That version silently does nothing, because
 * `<view>.focus` on a view whose `when` is false is a no-op rather than an
 * error. So it is pinned.
 */
describe('Navigator', () => {
  const vscode = require('vscode');
  let detail: jest.Mocked<DetailTreeProvider>;
  let nav: Navigator;
  let order: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    order = [];

    detail = {
      setTicket: jest.fn(async () => { order.push('setTicket'); })
    } as any;

    vscode.commands.executeCommand.mockImplementation(async (...args: unknown[]) => {
      order.push(args.join(' '));
    });

    nav = new Navigator(detail);
  });

  it('loads the ticket, then flips the key, then focuses the view', async () => {
    await nav.showDetail('SABIN-0022');

    expect(order).toEqual([
      'setTicket',
      'setContext sabin.detail true',
      'sabin.detailView.focus'
    ]);
    expect(detail.setTicket).toHaveBeenCalledWith('SABIN-0022');
  });

  it('flips the key back before focusing the index', async () => {
    await nav.showIndex();

    expect(order).toEqual([
      'setContext sabin.detail false',
      'sabin.indexView.focus'
    ]);
  });

  it('has no current ticket until one is opened', () => {
    expect(nav.current()).toBeUndefined();
  });

  // Deliberate: going back to the index does not forget what you were on, so
  // ⌥⌘P still knows which scratchpad you mean
  it('keeps the last ticket after returning to the index', async () => {
    await nav.showDetail('SABIN-0022');
    await nav.showIndex();

    expect(nav.current()).toBe('SABIN-0022');
  });

  it('never touches the detail provider on the way to the index', async () => {
    await nav.showDetail('SABIN-0022');
    detail.setTicket.mockClear();

    await nav.showIndex();
    expect(detail.setTicket).not.toHaveBeenCalled();
  });
});
