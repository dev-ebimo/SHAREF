import { Hono } from "hono";
import { getOptions } from "../controllers/metaController.js";
import { protect } from "../middleware/protect.js";

const metaRoutes = new Hono();
metaRoutes.get("/options", protect, getOptions);
export default metaRoutes;
