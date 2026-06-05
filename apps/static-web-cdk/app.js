#!/usr/bin/env node
const path = require('path');
const cdk = require('aws-cdk-lib');
const route53 = require('aws-cdk-lib/aws-route53');
const acm = require('aws-cdk-lib/aws-certificatemanager');
const s3 = require('aws-cdk-lib/aws-s3');
const cloudfront = require('aws-cdk-lib/aws-cloudfront');
const origins = require('aws-cdk-lib/aws-cloudfront-origins');
const route53Targets = require('aws-cdk-lib/aws-route53-targets');
const s3deploy = require('aws-cdk-lib/aws-s3-deployment');

class StaticWebAppStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.zoneName
    });

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      versioned: true
    });

    const certificate = new acm.DnsValidatedCertificate(this, 'Certificate', {
      domainName: props.domainName,
      hostedZone: zone,
      region: 'us-east-1'
    });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: props.comment,
      certificate,
      domainNames: [props.domainName],
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: new origins.S3Origin(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(1)
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(1)
        }
      ]
    });

    new route53.ARecord(this, 'AliasRecord', {
      zone,
      recordName: props.domainName,
      target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution))
    });

    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(props.sitePath)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
      retainOnDelete: false
    });

    cdk.Tags.of(this).add('ManagedBy', 'mini-webapp-cdk');
    if (props.bundleId) {
      cdk.Tags.of(this).add('Bundle', props.bundleId);
    }
    if (props.version) {
      cdk.Tags.of(this).add('Version', props.version);
    }
    cdk.Tags.of(this).add('Domain', props.domainName);

    new cdk.CfnOutput(this, 'DomainName', { value: props.domainName });
    new cdk.CfnOutput(this, 'DistributionDomainName', { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
  }
}

const app = new cdk.App();
const stackName = app.node.tryGetContext('stackName');
const domainName = app.node.tryGetContext('domainName');
const zoneName = app.node.tryGetContext('zoneName');
const sitePath = app.node.tryGetContext('sitePath') || path.join(__dirname, 'empty-site');
const account = app.node.tryGetContext('account');
const region = app.node.tryGetContext('region');
const bundleId = app.node.tryGetContext('bundleId') || '';
const version = app.node.tryGetContext('version') || '';
const comment = app.node.tryGetContext('comment') || `Static web app ${domainName || ''}`.trim();

// Tutto esplicito: nessun default geografico/account silenzioso (evita deploy nel posto sbagliato).
if (!stackName || !domainName || !zoneName || !account || !region) {
  throw new Error('Missing required CDK context: stackName, domainName, zoneName, account, region');
}

new StaticWebAppStack(app, stackName, {
  env: {
    account,
    region
  },
  stackName,
  domainName,
  zoneName,
  sitePath,
  bundleId,
  version,
  comment
});
