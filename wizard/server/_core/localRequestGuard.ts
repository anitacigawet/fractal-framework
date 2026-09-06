import type { RequestHandler } from "express";

// A loopback bind is not a browser authorization check. Pin the authority
// to our listener, never to a caller-supplied Host/Forwarded header.
export function localRequestGuard(port: number): RequestHandler {
  const authority = `127.0.0.1:${port}`;
  const origin = `http://${authority}`;
  return (req, res, next) => {
    if (req.headers.host !== authority) {
      res.status(403).json({ error: "Use the wizard's 127.0.0.1 address." });
      return;
    }
    const suppliedOrigin = req.headers.origin;
    const fetchSite = req.headers["sec-fetch-site"];
    if (
      (suppliedOrigin !== undefined && suppliedOrigin !== origin) ||
      (fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none")
    ) {
      res.status(403).json({ error: "Cross-origin wizard requests are not allowed." });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      // The browser wizard uses same-origin JSON, never form/binary transports.
      if (req.method !== "POST" || suppliedOrigin !== origin) {
        res.status(403).json({ error: "A same-origin POST is required." });
        return;
      }
      if (req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        res.status(415).json({ error: "Wizard mutations require application/json." });
        return;
      }
    }
    next();
  };
}
