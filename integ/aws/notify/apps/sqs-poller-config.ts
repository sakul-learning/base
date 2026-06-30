// https://github.com/aws/aws-cdk/blob/v2.232.2/packages/@aws-cdk-testing/framework-integ/test/aws-lambda-event-sources/test/integ.sqs-with-poller-config.ts
import { App, LocalBackend, TerraformOutput } from "cdktn";
import { Construct } from "constructs";
import { Duration, aws } from "../../../../src";

/**
 * The standard nodejs runtime used for integration tests.
 * Use this, unless specifically testing a certain runtime.
 *
 * The runtime should be the lowest runtime currently supported by the AWS CDK.
 * Updating this value will require you to run a lot of integration tests.
 */
export const STANDARD_NODEJS_RUNTIME = aws.compute.Runtime.NODEJS_18_X;

const environmentName = process.env.ENVIRONMENT_NAME ?? "test";
const region = process.env.AWS_REGION ?? "us-east-1";
const outdir = process.env.OUT_DIR ?? "cdktf.out";
const stackName = process.env.STACK_NAME ?? "sqs-poller-config";

class SqsProvisionedPollerConfigStack extends aws.AwsStack {
  constructor(scope: Construct, id: string, props: aws.AwsStackProps) {
    super(scope, id, props);

    const queue = new aws.notify.Queue(this, "Queue");

    const fnMaximumOnly = new aws.compute.LambdaFunction(this, "FunctionMaximumOnly", {
      handler: "index.handler",
      code: aws.compute.Code.fromInline(`exports.handler = ${handler.toString()}`),
      runtime: STANDARD_NODEJS_RUNTIME,
    });
    const maximumOnly = new aws.compute.sources.SqsEventSource(queue, {
      provisionedPollerConfig: {
        maximumPollers: 1000,
      },
    });
    fnMaximumOnly.addEventSource(maximumOnly);

    const fnMinimumOnly = new aws.compute.LambdaFunction(this, "FunctionMinimumOnly", {
      handler: "index.handler",
      code: aws.compute.Code.fromInline(`exports.handler = ${handler.toString()}`),
      runtime: STANDARD_NODEJS_RUNTIME,
    });
    const minimumOnly = new aws.compute.sources.SqsEventSource(queue, {
      provisionedPollerConfig: {
        minimumPollers: 3,
      },
    });
    fnMinimumOnly.addEventSource(minimumOnly);

    const fnBoth = new aws.compute.LambdaFunction(this, "FunctionBoth", {
      handler: "index.handler",
      code: aws.compute.Code.fromInline(`exports.handler = ${handler.toString()}`),
      runtime: STANDARD_NODEJS_RUNTIME,
    });
    const both = new aws.compute.sources.SqsEventSource(queue, {
      provisionedPollerConfig: {
        minimumPollers: 3,
        maximumPollers: 1000,
      },
    });
    fnBoth.addEventSource(both);

    // Separate queue/function for the active validation so the AWS CDK parity
    // mappings above do not race each other while consuming from one shared queue.
    const loadQueue = new aws.notify.Queue(this, "LoadQueue", {
      registerOutputs: true,
      outputName: "load_queue",
      visibilityTimeout: Duration.seconds(60),
    });
    const loadFunction = new aws.compute.LambdaFunction(this, "LoadFunction", {
      handler: "index.handler",
      code: aws.compute.Code.fromInline(`exports.handler = ${handler.toString()}`),
      runtime: STANDARD_NODEJS_RUNTIME,
      registerOutputs: true,
      outputName: "load_function",
    });
    const loadMapping = new aws.compute.sources.SqsEventSource(loadQueue, {
      batchSize: 10,
      reportBatchItemFailures: true,
      provisionedPollerConfig: {
        minimumPollers: 2,
        maximumPollers: 10,
      },
    });
    loadFunction.addEventSource(loadMapping);

    new TerraformOutput(this, "MaximumOnlyEventSourceMappingId", {
      value: maximumOnly.eventSourceMappingId,
      staticId: true,
    });
    new TerraformOutput(this, "MinimumOnlyEventSourceMappingId", {
      value: minimumOnly.eventSourceMappingId,
      staticId: true,
    });
    new TerraformOutput(this, "BothEventSourceMappingId", {
      value: both.eventSourceMappingId,
      staticId: true,
    });
    new TerraformOutput(this, "LoadEventSourceMappingId", {
      value: loadMapping.eventSourceMappingId,
      staticId: true,
    });
  }
}

const app = new App({
  outdir,
});

const stack = new SqsProvisionedPollerConfigStack(app, stackName, {
  gridUUID: "12345678-1234",
  environmentName,
  providerConfig: {
    region,
  },
});
new LocalBackend(stack, {
  path: `${stackName}.tfstate`,
});

app.synth();

/* eslint-disable no-console */
async function handler(event: any) {
  console.log(
    "sqs-poller-load-batch",
    JSON.stringify({ recordCount: event.Records?.length ?? 0 }),
  );
  return { batchItemFailures: [] };
}
