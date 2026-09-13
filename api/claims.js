import sql from "./_db.js";
import { uid } from "./_auth.js";

function rowToClaim(r) {
  return {
    id: r.id, itemId: r.item_id, itemTitle: r.item_title,
    claimant: {
      id: r.claimant_id, name: r.claimant_name,
      studentId: r.claimant_student_id, contact: r.claimant_contact,
    },
    message: r.message, status: r.status,
    createdAt: r.created_at, resolvedAt: r.resolved_at,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const rows = await sql`select * from claims order by created_at desc`;
      return res.json(rows.map(rowToClaim));
    }

    if (req.method === "POST") {
      const c = req.body;
      const id = uid();
      const rows = await sql`
        insert into claims (id, item_id, item_title, claimant_id, claimant_name,
                            claimant_student_id, claimant_contact, message)
        values (${id}, ${c.itemId}, ${c.itemTitle}, ${c.claimant.id}, ${c.claimant.name},
                ${c.claimant.studentId || null}, ${c.claimant.contact}, ${c.message})
        returning *
      `;

      await sql`
        insert into notifications (id, audience, title, body, related_item_id, related_claim_id)
        values (${uid()}, 'admin', 'New claim needs review',
                ${`${c.claimant.name} says "${c.itemTitle}" belongs to them.`},
                ${c.itemId}, ${id})
      `;

      return res.json(rowToClaim(rows[0]));
    }

    if (req.method === "PUT") {
      const { id, decision } = req.body;
      if (!id || !["approved", "rejected"].includes(decision)) {
        return res.status(400).json({ error: "Invalid decision" });
      }
      const claimRows = await sql`select * from claims where id = ${id}`;
      if (claimRows.length === 0) return res.status(404).json({ error: "Not found" });
      const claim = claimRows[0];

      const nowIso = new Date().toISOString();
      await sql`update claims set status = ${decision}, resolved_at = ${nowIso} where id = ${id}`;

      if (decision === "approved") {
        await sql`
          update items set status = 'resolved', resolved_at = ${nowIso},
                           resolved_for = ${claim.claimant_name}
          where id = ${claim.item_id}
        `;
        await sql`
          update claims set status = 'rejected', resolved_at = ${nowIso}
          where item_id = ${claim.item_id} and id != ${id} and status = 'pending'
        `;
      }

      await sql`
        insert into notifications (id, audience, title, body, related_item_id)
        values (${uid()}, ${claim.claimant_id},
                ${decision === "approved" ? "Claim approved" : "Claim not verified"},
                ${decision === "approved"
                  ? `Your claim on "${claim.item_title}" was verified. Coordinate pickup using the contact info on the post.`
                  : `Your claim on "${claim.item_title}" wasn't verified. You can post more detail or contact the admin.`},
                ${claim.item_id})
      `;

      return res.json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}