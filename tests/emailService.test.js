jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('emailService', () => {
  let nodemailer;
  let sendMailMock;

  const resetEnv = () => {
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;
    delete process.env.EMAIL_PORT;
    delete process.env.EMAIL_SECURE;
    delete process.env.EMAIL_FROM;
  };

  const loadService = () => {
    let moduleExports;
    jest.isolateModules(() => {
      moduleExports = require('../utils/emailService');
    });
    return moduleExports;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetEnv();
    nodemailer = require('nodemailer');
    sendMailMock = jest.fn().mockResolvedValue({ accepted: ['recipient@example.com'] });
    nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });
  });

  afterEach(() => {
    resetEnv();
  });

  it('sends an email with HTML automatically generated from the message body', async () => {
    process.env.EMAIL_HOST = 'smtp.example.com';
    process.env.EMAIL_USER = 'mailer@example.com';
    process.env.EMAIL_PASS = 'secret';
    process.env.EMAIL_FROM = 'no-reply@example.com';

    const { sendEmail } = loadService();

    await sendEmail(
      'recipient@example.com',
      'Subject Line',
      'Line one\n\nLine two',
      {
        cc: ['cc1@example.com', ''],
        bcc: 'bcc1@example.com, bcc2@example.com',
        replyTo: 'reply@example.com',
        attachments: [{ filename: 'test.txt', content: 'hello' }],
      },
    );

    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'mailer@example.com', pass: 'secret' },
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const payload = sendMailMock.mock.calls[0][0];

    expect(payload).toMatchObject({
      from: 'no-reply@example.com',
      to: ['recipient@example.com'],
      cc: ['cc1@example.com'],
      bcc: ['bcc1@example.com', 'bcc2@example.com'],
      subject: 'Subject Line',
      text: 'Line one\n\nLine two',
      replyTo: 'reply@example.com',
      attachments: [{ filename: 'test.txt', content: 'hello' }],
    });

    expect(payload.html).toContain('<p style="margin: 0 0 12px;">Line one</p>');
    expect(payload.html).toContain('<p style="margin: 0 0 12px;">&nbsp;</p>');
    expect(payload.html).toContain('<p style="margin: 0 0 12px;">Line two</p>');
  });

  it('honors custom HTML and text overrides', async () => {
    process.env.EMAIL_HOST = 'smtp.example.com';
    process.env.EMAIL_USER = 'mailer@example.com';

    const { sendEmail } = loadService();

    await sendEmail('user@example.com', 'Subject', 'Ignored body', {
      html: '<strong>Custom</strong>',
      text: 'Plain text',
      enableHtml: true,
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: '<strong>Custom</strong>',
        text: 'Plain text',
      }),
    );
  });

  it('logs and exits early when no transporter is configured', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const { sendEmail } = loadService();

    const result = await sendEmail('user@example.com', 'Subject', 'Body');

    expect(result).toBeNull();
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '📨 Email skipped (transporter not configured)',
      expect.objectContaining({ to: ['user@example.com'], subject: 'Subject' }),
    );

    infoSpy.mockRestore();
  });
});