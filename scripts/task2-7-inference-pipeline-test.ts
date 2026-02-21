import {
  inspectAstPluginCapabilities,
  runAstPipelineWithPlugins,
} from '../packages/inference/src/plugins';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function relationTypesOf(filePath: string, content: string): Set<string> {
  const result = runAstPipelineWithPlugins({ path: filePath, content });
  return new Set(result.signals.map((signal) => signal.relationType ?? 'depend_on'));
}

function assertRelationTypes(types: Set<string>, expected: string[], label: string): void {
  for (const relationType of expected) {
    assert(types.has(relationType), `${label}: relationType "${relationType}" not detected`);
  }
}

function main() {
  const capabilities = inspectAstPluginCapabilities();

  for (const capability of capabilities) {
    assert(capability.hasParseStage, `${capability.id}: parse stage is not implemented`);
    assert(capability.hasExtractStage, `${capability.id}: extract stage is not implemented`);
    assert(capability.hasNormalizeStage, `${capability.id}: normalize stage is not implemented`);
    assert(capability.hasEmitStage, `${capability.id}: emit stage is not implemented`);
  }

  const javaTypes = relationTypesOf(
    'src/main/java/com/example/OrderService.java',
    `
      import com.example.client.PaymentClient;
      @KafkaListener(topics = "order-events")
      public void consume() {}
      public void publish() { kafkaTemplate.send("payments", payload); }
      public void load() { repository.findById(id); }
      public void save() { repository.save(entity); }
      public void call() { webClient.retrieve(); }
    `,
  );
  assertRelationTypes(javaTypes, ['call', 'read', 'write', 'produce', 'consume'], 'java-kotlin');

  const tsTypes = relationTypesOf(
    'src/orders/service.ts',
    `
      import { PaymentClient } from "@acme/payment-service";
      const token = process.env.PAYMENT_API;
      await fetch("https://billing.internal/v1/payments");
      await prisma.order.findMany();
      await prisma.order.create({ data: {} });
      await producer.send({ topic: "payments" });
      await consumer.subscribe({ topic: "orders" });
    `,
  );
  assertRelationTypes(tsTypes, ['call', 'read', 'write', 'produce', 'consume'], 'typescript');

  const pyTypes = relationTypesOf(
    'app/orders/handler.py',
    `
      from integrations.payment_client import payment_client
      @app.get("/orders")
      def read_orders():
          session.query(Order).all()
          producer.send("payments", payload)
          return []
      def write_order():
          session.add(order)
          session.commit()
      @app.task
      def consume_events():
          consumer.subscribe(["orders"])
    `,
  );
  assertRelationTypes(pyTypes, ['expose', 'read', 'write', 'produce', 'consume'], 'python');

  const lowConfidenceResult = runAstPipelineWithPlugins({
    path: 'src/simple/import-only.ts',
    content: `import { A } from "@acme/simple";`,
  });
  const lowConfidenceSignal = lowConfidenceResult.signals[0];
  assert(!!lowConfidenceSignal, 'low-confidence sample produced no signal');
  assert(lowConfidenceSignal.reviewLane === 'low_confidence', 'low-confidence lane tagging mismatch');
  assert(!!lowConfidenceSignal.scoreVersion, 'score version is missing');
  assert(Array.isArray(lowConfidenceSignal.evidences), 'structured evidence is missing');
  assert((lowConfidenceSignal.evidences?.[0]?.schemaVersion ?? '') === 'v1', 'evidence schema version mismatch');

  console.log('OK: task2-7 inference pipeline verification passed.');
}

main();
