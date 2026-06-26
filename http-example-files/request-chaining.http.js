const loginRes = await $kulala.runRequest(
  "login",
  "./request-chaining/request-chaining-login.http",
);
const token = loginRes.body.json.token;
client.global.set("request-chaining-token", token);

const userRes = await $kulala.runRequest(
  "get-users",
  "./request-chaining/request-chaining-get-users.http",
);
const users = userRes.body.json.data;

client.global.set(
  "request-chaining-users-userId",
  users.find((user) => user.name === "Bob").id,
);
