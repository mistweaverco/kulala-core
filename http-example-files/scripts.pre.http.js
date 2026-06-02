client.log("Current iteration from JS", request.iteration());
request.variables.set("TYPE_FROM_JS", "kulala-type-from-js");
client.global.set("HEADER_VALUE_FROM_JS", "header-value-from-lua");
request.variables.set("users_from_js", [{ name: "Alice" }, { name: "Bob" }]);
request.variables.set("user_from_js", { name: "Charlie" });
client.test("does work", () => {
  client.assert(
    request.variables.get("TYPE_FROM_JS") === "kulala-type-from-js",
    "TYPE_FROM_JS should be set correctly",
  );
});
