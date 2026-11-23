// GET /images/search?name=&activeIngredient=&strength=&form=  ->  { url, source, colombian } ({} si no hay imagen)
import { Router } from 'express';
import { findImage } from '../services.js';
import { generalLimit } from '../middleware/security.js';

const router = Router();
router.use(generalLimit);

const q = (v) => String(v ?? '').trim().slice(0, 80);

router.get('/search', async (req, res, next) => {
  try {
    const name = q(req.query.name);
    if (!name) return res.status(400).json({ error: 'Falta el nombre del medicamento.' });
    const found = await findImage({ name, activeIngredient: q(req.query.activeIngredient), strength: q(req.query.strength), form: q(req.query.form) });
    res.json(found || {});
  } catch (e) { next(e); }
});

export default router;
