import { Hono } from "hono";
import { toggleBookmark, getBookmarks, checkBookmark } from "../controllers/bookmarkController.js";
import { protect } from "../middleware/protect.js";

const bookmarkRoutes = new Hono();

bookmarkRoutes.use("*", protect);

bookmarkRoutes.get("/", getBookmarks);
bookmarkRoutes.get("/check/:resourceId", checkBookmark);
bookmarkRoutes.post("/:resourceId", toggleBookmark);

export default bookmarkRoutes;
