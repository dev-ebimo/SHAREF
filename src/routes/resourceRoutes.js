import { Hono } from "hono";
import { getMyUploads, getResources, getResourceById, uploadResource } from "../controllers/resourceController.js";
import {
  getRecentFeed,
  getTrending,
  getContinueLearning,
  searchPastQuestions,
  getResourcePreview,
} from "../controllers/browseController.js";
import { streamResourceDownload } from "../controllers/downloadController.js";
import { protect } from "../middleware/protect.js";

const resourceRoutes = new Hono();

resourceRoutes.post("/upload", protect, uploadResource);

resourceRoutes.get("/recent", protect, getRecentFeed);
resourceRoutes.get("/trending", protect, getTrending);
resourceRoutes.get("/continue-learning", protect, getContinueLearning);
resourceRoutes.get("/past-questions", protect, searchPastQuestions);
resourceRoutes.get("/my-uploads", protect, getMyUploads);
resourceRoutes.get("/:id/preview", protect, getResourcePreview);

// Deliberately no `protect` here — reached by a plain browser navigation,
// not an authenticated fetch. Access is controlled by the short-lived
// signed token in the query string instead — see utils/downloadToken.js.
resourceRoutes.get("/:id/stream", streamResourceDownload);

resourceRoutes.get("/", protect, getResources);
resourceRoutes.get("/:id", protect, getResourceById);

export default resourceRoutes;
