import { Hono } from "hono";
import { getMyUploads, getResources, getResourceById } from "../controllers/resourceController.js";
import { requestUploadPermit, completeUpload } from "../controllers/uploadController.js";
import {
  getRecentFeed,
  getTrending,
  getContinueLearning,
  searchPastQuestions,
  getResourcePreview,
} from "../controllers/browseController.js";
import { streamResourceDownload } from "../controllers/downloadController.js";
import { protect } from "../middleware/protect.js";
import { uploadPermitLimiter } from "../middleware/rateLimiter.js";

const resourceRoutes = new Hono();

// Direct-to-Cloudinary upload: permit -> (browser uploads to Cloudinary) -> complete.
resourceRoutes.post("/upload/permit", protect, uploadPermitLimiter, requestUploadPermit);
resourceRoutes.post("/upload/complete", protect, completeUpload);

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
