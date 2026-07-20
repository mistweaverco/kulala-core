const ITERATIONS = 10;
const RESPONSE_TIMES = new Map();
const REQUEST_ORDER = [];
const EXPECTED_STATUS = 200;
const START_TIME = Date.now();

const PROMISES = Array.from({ length: ITERATIONS }, (_, i) =>
  (async () => {
    const start = Date.now();
    const response = await $kulala.runRequest(
      "load-test-template",
      "./request-template.http",
    );
    const end = Date.now();
    RESPONSE_TIMES.set(i + 1, end - start);
    REQUEST_ORDER.push(i + 1);
    client.assert(
      response.status === EXPECTED_STATUS,
      response.status === EXPECTED_STATUS
        ? `Iteration ${i + 1}: Status is ${EXPECTED_STATUS}`
        : `Iteration ${i + 1}: Expected status ${EXPECTED_STATUS} but got ${response.status}`,
    );
    return response;
  })(),
);

await Promise.all(PROMISES);

const END_TIME = Date.now();
const DURATION = END_TIME - START_TIME;

client.log(`Completed ${ITERATIONS} iterations in ${DURATION} ms`);
client.log(
  `Average response time: ${[...RESPONSE_TIMES.values()].reduce((a, b) => a + b, 0) / RESPONSE_TIMES.size} ms`,
);
client.log(`Longest response time: ${Math.max(...RESPONSE_TIMES.values())} ms`);
client.log(
  `Shortest response time: ${Math.min(...RESPONSE_TIMES.values())} ms`,
);
client.log(`Request order: ${REQUEST_ORDER.join(", ")}`);
