import sql from "./_db.js";

function rowToNotif(r) {
  return {
    id: r.id, audience: r.audience, title: r.title, body: r.body,
    read: !!r.read,
    relatedItemId: r.related_item_id, relatedClaimId: r.related_claim_id,
    createdAt: r.created_at,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const rows = await sql`select * from notifications order by created_at desc`;
      return res.json(rows.map(rowToNotif));
    }

    if (req.method === "PUT") {
      const { id, audience } = req.body;

      if (audience) {
        await sql`update notifications set read = true where audience = ${audience}`;
        return res.json({ ok: true });
      }

      if (id) {
        await sql`update notifications set read = true where id = ${id}`;
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: "Missing id or audience" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}