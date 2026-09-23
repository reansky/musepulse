module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "GET required." });
  }

  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return response.status(503).json({ error: "Human account service is not configured." });

  response.setHeader("Cache-Control", "private, no-store");
  return response.status(200).json({ url, publishableKey });
};
