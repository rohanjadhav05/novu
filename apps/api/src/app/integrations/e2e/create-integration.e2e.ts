import { IntegrationRepository, EnvironmentRepository } from '@novu/dal';
import { UserSession } from '@novu/testing';
import { ChannelTypeEnum, EmailProviderIdEnum, SmsProviderIdEnum } from '@novu/shared';
import { expect } from 'chai';

const ORIGINAL_IS_MULTI_PROVIDER_CONFIGURATION_ENABLED = process.env.IS_MULTI_PROVIDER_CONFIGURATION_ENABLED;

describe('Create Integration - /integration (POST)', function () {
  let session: UserSession;
  const integrationRepository = new IntegrationRepository();
  const envRepository = new EnvironmentRepository();

  beforeEach(async () => {
    session = new UserSession();
    await session.initialize();
    process.env.IS_MULTI_PROVIDER_CONFIGURATION_ENABLED = 'true';
  });

  afterEach(async () => {
    process.env.IS_MULTI_PROVIDER_CONFIGURATION_ENABLED = ORIGINAL_IS_MULTI_PROVIDER_CONFIGURATION_ENABLED;
  });

  it('should get the email integration successfully', async function () {
    const integrations = (await session.testAgent.get(`/v1/integrations`)).body.data;

    const emailIntegrations: any[] = integrations
      .filter((searchIntegration) => searchIntegration.channel === ChannelTypeEnum.EMAIL)
      .filter((integration) => integration.providerId !== EmailProviderIdEnum.Novu);

    expect(emailIntegrations.length).to.eql(2);

    for (const emailIntegration of emailIntegrations) {
      expect(emailIntegration.providerId).to.equal(EmailProviderIdEnum.SendGrid);
      expect(emailIntegration.channel).to.equal(ChannelTypeEnum.EMAIL);
      expect(emailIntegration.credentials.apiKey).to.equal('SG.123');
      expect(emailIntegration.credentials.secretKey).to.equal('abc');
      expect(emailIntegration.active).to.equal(true);
    }
  });

  it('should get the sms integration successfully', async function () {
    const integrations = (await session.testAgent.get(`/v1/integrations`)).body.data;

    const smsIntegrations: any[] = integrations
      .filter((searchIntegration) => searchIntegration.channel === ChannelTypeEnum.SMS)
      .filter((integration) => integration.providerId !== SmsProviderIdEnum.Novu);

    expect(smsIntegrations.length).to.eql(2);

    for (const smsIntegration of smsIntegrations) {
      expect(smsIntegration.providerId).to.equal(SmsProviderIdEnum.Twilio);
      expect(smsIntegration.channel).to.equal(ChannelTypeEnum.SMS);
      expect(smsIntegration.credentials.accountSid).to.equal('AC123');
      expect(smsIntegration.credentials.token).to.equal('123');
      expect(smsIntegration.active).to.equal(true);
    }
  });

  it('should allow creating the same provider on same environment twice', async function () {
    await integrationRepository.deleteMany({
      _organizationId: session.organization._id,
      _environmentId: session.environment._id,
    });

    const payload = {
      name: EmailProviderIdEnum.SendGrid,
      providerId: EmailProviderIdEnum.SendGrid,
      channel: ChannelTypeEnum.EMAIL,
      credentials: { apiKey: '123', secretKey: 'abc' },
      active: true,
      check: false,
    };

    await insertIntegrationTwice(session, payload, false);

    const integrations = (await session.testAgent.get(`/v1/integrations`)).body.data;

    const sendgridIntegrations = integrations.filter(
      (integration) =>
        integration.channel === payload.channel &&
        integration._environmentId === session.environment._id &&
        integration.providerId === EmailProviderIdEnum.SendGrid
    );

    expect(sendgridIntegrations.length).to.eql(2);

    for (const integration of sendgridIntegrations) {
      expect(integration.name).to.equal(payload.name);
      expect(integration.identifier).to.exist;
      expect(integration.providerId).to.equal(EmailProviderIdEnum.SendGrid);
      expect(integration.channel).to.equal(ChannelTypeEnum.EMAIL);
      expect(integration.credentials.apiKey).to.equal(payload.credentials.apiKey);
      expect(integration.credentials.secretKey).to.equal(payload.credentials.secretKey);
      expect(integration.active).to.equal(payload.active);
    }
  });

  it('should not allow to create integration with same identifier', async function () {
    const payload = {
      providerId: EmailProviderIdEnum.SendGrid,
      channel: ChannelTypeEnum.EMAIL,
      identifier: 'identifier',
      active: false,
      check: false,
    };
    await integrationRepository.create({
      name: 'Test',
      identifier: payload.identifier,
      providerId: EmailProviderIdEnum.SendGrid,
      channel: ChannelTypeEnum.EMAIL,
      active: false,
      _organizationId: session.organization._id,
      _environmentId: session.environment._id,
    });

    const { body } = await session.testAgent.post('/v1/integrations').send(payload);

    expect(body.statusCode).to.equal(409);
    expect(body.message).to.equal('Integration with identifier already exists');
  });

  it('should not allow to activate the integration without the credentials', async function () {
    const payload = {
      providerId: EmailProviderIdEnum.SendGrid,
      channel: ChannelTypeEnum.EMAIL,
      active: true,
      check: false,
    };

    const { body } = await session.testAgent.post('/v1/integrations').send(payload);

    expect(body.statusCode).to.equal(400);
    expect(body.message).to.equal('The credentials are required to activate the integration');
  });

  it('should allow creating the integration with minimal data', async function () {
    const payload = {
      providerId: EmailProviderIdEnum.SendGrid,
      channel: ChannelTypeEnum.EMAIL,
      check: false,
    };

    const {
      body: { data },
    } = await session.testAgent.post('/v1/integrations').send(payload);

    expect(data.name).to.equal('SendGrid');
    expect(data.identifier).to.exist;
    expect(data.providerId).to.equal(EmailProviderIdEnum.SendGrid);
    expect(data.channel).to.equal(ChannelTypeEnum.EMAIL);
    expect(data.active).to.equal(false);
  });

  it('should allow creating the integration in the chosen environment', async function () {
    const prodEnv = await envRepository.findOne({ name: 'Production', _organizationId: session.organization._id });
    const payload = {
      providerId: EmailProviderIdEnum.SendGrid,
      channel: ChannelTypeEnum.EMAIL,
      _environmentId: prodEnv?._id,
      check: false,
    };

    const {
      body: { data },
    } = await session.testAgent.post('/v1/integrations').send(payload);

    expect(data.name).to.equal('SendGrid');
    expect(data._environmentId).to.equal(prodEnv?._id);
    expect(data.identifier).to.exist;
    expect(data.providerId).to.equal(EmailProviderIdEnum.SendGrid);
    expect(data.channel).to.equal(ChannelTypeEnum.EMAIL);
    expect(data.active).to.equal(false);
  });

  it('should create custom SMTP integration with TLS options successfully', async function () {
    const payload = {
      providerId: EmailProviderIdEnum.CustomSMTP,
      channel: ChannelTypeEnum.EMAIL,
      credentials: {
        host: 'smtp.example.com',
        port: '587',
        secure: true,
        requireTls: true,
        tlsOptions: { rejectUnauthorized: false },
      },
      active: true,
      check: false,
    };

    const {
      body: { data },
    } = await session.testAgent.post('/v1/integrations').send(payload);

    expect(data.credentials?.host).to.equal(payload.credentials.host);
    expect(data.credentials?.port).to.equal(payload.credentials.port);
    expect(data.credentials?.secure).to.equal(payload.credentials.secure);
    expect(data.credentials?.requireTls).to.equal(payload.credentials.requireTls);
    expect(data.credentials?.tlsOptions).to.instanceOf(Object);
    expect(data.credentials?.tlsOptions).to.eql(payload.credentials.tlsOptions);
    expect(data.active).to.equal(true);
  });
});

async function insertIntegrationTwice(
  session: UserSession,
  payload: { credentials: { apiKey: string; secretKey: string }; providerId: string; channel: string; active: boolean },
  createDiffChannels: boolean
) {
  await session.testAgent.post('/v1/integrations').send(payload);

  if (createDiffChannels) {
    // eslint-disable-next-line no-param-reassign
    payload.channel = ChannelTypeEnum.SMS;
  }

  return await session.testAgent.post('/v1/integrations').send(payload);
}
