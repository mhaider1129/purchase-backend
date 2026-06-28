jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../utils/emailService', () => ({
  sendEmail: jest.fn(),
}));

const pool = require('../config/db');
const { sendEmail } = require('../utils/emailService');
const {
  fetchRequestEmailRecipients,
  sendRequestWorkflowEmail,
  sendWorkflowEmail,
  _private,
} = require('../utils/workflowEmailNotifications');

describe('workflowEmailNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendEmail.mockResolvedValue({ accepted: ['requester@example.com'] });
  });

  it('normalizes and deduplicates workflow recipients', () => {
    expect(_private.normalizeRecipients(['a@example.com', ' ', 'a@example.com', null, 'b@example.com'])).toEqual([
      'a@example.com',
      'b@example.com',
    ]);
  });

  it('fetches request participants and procurement recipients', async () => {
    pool.query.mockResolvedValue({
      rows: [
        { email: 'requester@example.com' },
        { email: 'buyer@example.com' },
        { email: 'requester@example.com' },
      ],
    });

    await expect(fetchRequestEmailRecipients(42)).resolves.toEqual([
      'requester@example.com',
      'buyer@example.com',
    ]);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM requests r'), [42, true]);
  });

  it('sends request workflow emails to resolved recipients', async () => {
    pool.query.mockResolvedValue({ rows: [{ email: 'requester@example.com' }, { email: 'scm@example.com' }] });

    await sendRequestWorkflowEmail({
      requestId: 77,
      subject: 'Status changed',
      message: 'A workflow event happened.',
      includeScm: false,
    });

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM requests r'), [77, false]);
    expect(sendEmail).toHaveBeenCalledWith(
      ['requester@example.com', 'scm@example.com'],
      'Status changed',
      'A workflow event happened.',
      {}
    );
  });

  it('skips sending when no recipients are available', async () => {
    await sendWorkflowEmail({ to: [], subject: 'No-op', message: 'Nobody receives this.' });

    expect(sendEmail).not.toHaveBeenCalled();
  });
});