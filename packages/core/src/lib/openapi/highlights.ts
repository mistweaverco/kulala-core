/** Swagger-UI-like HTTP method colors for UI consumers. */
export function methodHighlightColor(method: string): string | undefined {
  switch (method.toUpperCase()) {
    case "GET":
      return "#61affe";
    case "POST":
      return "#49cc90";
    case "PUT":
      return "#fca130";
    case "DELETE":
      return "#f93e3e";
    case "PATCH":
      return "#50e3c2";
    case "HEAD":
      return "#9012fe";
    case "OPTIONS":
      return "#0d5aa7";
    default:
      return undefined;
  }
}
