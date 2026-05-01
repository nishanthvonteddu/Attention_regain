export function requestHasSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    if (originUrl.origin === requestUrl.origin) {
      return true;
    }

    const host = firstHeaderValue(request.headers.get("host"));
    if (!host) {
      return false;
    }
    const protocol = firstHeaderValue(request.headers.get("x-forwarded-proto")) ||
      requestUrl.protocol.replace(/:$/, "");

    return originUrl.origin === new URL(`${protocol}://${host}`).origin;
  } catch {
    return false;
  }
}

function firstHeaderValue(value) {
  return typeof value === "string" ? value.split(",")[0].trim() : "";
}
