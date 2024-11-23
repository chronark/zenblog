import { Context, Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { handle } from "hono/vercel";
import { createClient } from "@/lib/server/supabase";
import { axiom, AXIOM_DATASETS, getApiUsageForBlog } from "lib/axiom";
import {
  createOrRetrieveCustomer,
  createStripeClient,
} from "@/lib/server/stripe";
import { BASE_URL } from "@/lib/config";
import {
  isPricingPlanInterval,
  isPricingPlanId,
  PRICING_PLANS,
  PricingPlanInterval,
  PricingPlanId,
  TRIAL_PERIOD_DAYS,
} from "@/lib/pricing.constants";
import sharp from "sharp";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const UnauthorizedError = (c: Context) => {
  return c.json({ message: "Unauthorized" }, { status: 401 });
};

const BlogNotFoundError = (c: Context) => {
  return c.json({ message: "Blog not found" }, { status: 404 });
};

const ErrorRotatingAPIKey = (c: Context) => {
  return c.json({ message: "Error rotating API key" }, { status: 500 });
};

const errors = {
  UnauthorizedError,
  BlogNotFoundError,
  ErrorRotatingAPIKey,
};

const handleError = (c: Context, error: keyof typeof errors, rawLog: any) => {
  console.log("🔴", error);
  axiom.ingest(AXIOM_DATASETS.api, {
    message: error,
    error: true,
    blogId: c.req.param("blogId"),
    userId: c.req.param("userId"),
    method: c.req.method,
    path: c.req.url,
    rawLog,
  });

  return errors[error](c);
};

const getUser = async () => {
  const supabase = createClient();
  const res = await supabase.auth.getUser();

  return {
    user: res.data.user,
    error: res.error,
  };
};

const getBlogOwnership = async (blogId: string, userId: string) => {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("blogs")
    .select("user_id")
    .eq("id", blogId)
    .single();

  if (error || !data) {
    return false;
  }

  return data.user_id === userId;
};

const createR2Client = () => {
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
};

const api = new Hono()
  .get(
    "/accounts/:user_id/checkout",
    zValidator(
      "query",
      z.object({
        plan: PricingPlanId,
        interval: PricingPlanInterval,
      })
    ),
    async (c) => {
      try {
        const stripe = createStripeClient();
        const { user, error } = await getUser();
        const userId = c.req.param("user_id");
        const plan = c.req.query("plan");
        const interval = c.req.query("interval");

        if (error || !user || !user.email || !plan || !interval) {
          console.log("🔴 error", error, user, plan, interval);
          axiom.ingest(AXIOM_DATASETS.stripe, {
            message: "Error loading checkout session",
            payload: { userId, plan, error, user },
            error: true,
          });
          return c.json(
            {
              error: "Error loading checkout session. Please contact support.",
            },
            { status: 500 }
          );
        }

        if (!isPricingPlanId(plan)) {
          console.log("🔴 !isPricingPlanId", plan);
          return c.json({ error: "Invalid plan" }, { status: 400 });
        }

        if (!isPricingPlanInterval(interval)) {
          console.log("🔴 !isPricingPlanInterval", interval);
          return c.json({ error: "Invalid interval" }, { status: 400 });
        }

        const customer = await createOrRetrieveCustomer({
          userId: user.id,
          email: user.email,
        });

        const selectedPlan = PRICING_PLANS.find((p) => p.id === plan);

        if (!selectedPlan) {
          console.log("🔴 !selectedPlan", selectedPlan);
          return c.json({ error: "Invalid plan" }, { status: 400 });
        }

        const price =
          selectedPlan?.[interval === "month" ? "monthlyPrice" : "yearlyPrice"];

        const session = await stripe.checkout.sessions.create({
          customer: customer.id,
          mode: "subscription",
          allow_promotion_codes: true,
          success_url: `${BASE_URL}/account?success=true`,
          cancel_url: `${BASE_URL}/account?canceled=true`,
          subscription_data: {
            trial_period_days: TRIAL_PERIOD_DAYS,
            metadata: {
              plan_id: selectedPlan.id,
            },
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                product_data: {
                  name: selectedPlan.title,
                  description: selectedPlan.description,
                },
                currency: "usd",
                unit_amount: price * 100,
                recurring: {
                  interval,
                },
              },
            },
          ],
        });

        if (!session.url) {
          console.log("🔴 !session.url", session.url);
          return c.json({ error: "Error creating session" }, { status: 500 });
        }

        console.log("session", session);

        return c.json({ url: session.url }, { status: 200 });
      } catch (error) {
        console.log("🔴 error", error);
        console.error(error);

        return c.json(
          { errorMessage: "Error creating session", error },
          { status: 500 }
        );
      }
    }
  )
  .get("/accounts/:user_id/customer-portal", async (c) => {
    try {
      const stripe = createStripeClient();
      const { user } = await getUser();

      if (!user) {
        return c.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (!user.email) {
        return c.json({ error: "User email not found" }, { status: 400 });
      }

      const customer = await createOrRetrieveCustomer({
        userId: user.id,
        email: user.email,
      });

      const session = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: process.env.NEXT_PUBLIC_BASE_URL + "/account",
      });

      return c.json({ url: session.url }, { status: 200 });
    } catch (error) {
      console.error(error);
      return c.json(
        { error: "Error creating customer portal" },
        { status: 500 }
      );
    }
  })
  .get(
    "/blogs/:blog_id/usage",
    zValidator(
      "query",
      z.object({
        start_time: z.string(),
        end_time: z.string(),
      })
    ),
    async (c) => {
      const blogId = c.req.param("blog_id");
      const startTime = c.req.query("start_time");
      const endTime = c.req.query("end_time");

      if (!blogId || !startTime || !endTime) {
        return c.json({ error: "Missing parameters" }, { status: 400 });
      }
      console.log("🥬 all good so far");

      const res = await getApiUsageForBlog(blogId, startTime, endTime);
      console.log("🥬 res", res);

      return c.json(res);
    }
  )
  .post(
    "/blogs/:blog_id/images",
    zValidator(
      "query",
      z.object({
        convertToWebp: z.string().optional(),
        imageName: z.string().optional(),
      })
    ),
    zValidator(
      "form",
      z.object({
        image: z.instanceof(File),
      })
    ),
    async (c) => {
      try {
        const blogId = c.req.param("blog_id");

        // Check if the user owns the blog
        const { user } = await getUser();
        if (!user || !user.id) {
          console.log("🔴 !user || !user.id", user);
          return c.json({ error: "Unauthorized" }, { status: 401 });
        }

        const isOwner = await getBlogOwnership(blogId, user.id);

        if (!isOwner) {
          console.log("🔴 !isOwner", user.id, blogId);
          return c.json({ error: "Unauthorized" }, { status: 401 });
        }

        const convertToWebp = c.req.query("convertToWebp") === "true";
        const providedName = c.req.query("imageName");

        // Get the file from the request
        const formData = await c.req.formData();
        const file = formData.get("image") as File;

        if (!file) {
          return c.json({ error: "No image provided" }, { status: 400 });
        }

        // Convert file to buffer
        const buffer = Buffer.from(await file.arrayBuffer());

        // Process image with Sharp
        let imageProcessor = sharp(buffer)
          .resize(2560, 2560, {
            // Max dimensions
            fit: "inside",
            withoutEnlargement: true, // Don't upscale
          })
          .jpeg({ quality: 80 }); // Compress

        if (convertToWebp) {
          imageProcessor = imageProcessor.webp({ quality: 80 });
        }

        const processedImage = await imageProcessor.toBuffer();

        // Upload to R2
        const r2 = createR2Client();
        const timestamp = Date.now().toString().slice(-6); // Last 6 digits of timestamp
        const baseName = providedName
          ? providedName
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "-") // Replace non-alphanumeric with hyphens
              .replace(/-+/g, "-") // Replace multiple hyphens with single
              .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
          : "image";

        const fileName = `${baseName}-${timestamp}.${
          convertToWebp ? "webp" : "jpg"
        }`;

        try {
          await r2.send(
            new PutObjectCommand({
              Bucket: process.env.R2_IMAGES_BUCKET_NAME,
              Key: fileName,
              Body: processedImage,
              ContentType: convertToWebp ? "image/webp" : "image/jpeg",
              Metadata: {
                blog_id: blogId,
                uploaded_at: new Date().toISOString(),
              },
            })
          );

          // Construct the public URL
          const publicUrl = `https://${process.env.R2_PUBLIC_DOMAIN}/${fileName}`;

          // Insert record into blog_images table
          const supabase = createClient();
          const { error: dbError } = await supabase.from("blog_images").insert({
            blog_id: blogId,
            file_name: fileName,
            file_url: publicUrl,
            size_in_bytes: processedImage.length,
            content_type: convertToWebp ? "image/webp" : "image/jpeg",
          });

          if (dbError) {
            console.error("Database insert error:", dbError);
            // Attempt to clean up the R2 upload
            try {
              await r2.send(
                new DeleteObjectCommand({
                  Bucket: process.env.R2_IMAGES_BUCKET_NAME,
                  Key: fileName,
                })
              );
              return c.json(
                { error: "Failed to save image metadata" },
                { status: 500 }
              );
            } catch (deleteError) {
              // Log both errors for investigation
              console.error("Failed to delete orphaned R2 image:", deleteError);
              axiom.ingest(AXIOM_DATASETS.api, {
                message: "Orphaned R2 image",
                fileName,
                blogId,
                dbError,
                deleteError,
                error: true,
              });
              return c.json(
                { error: "Failed to process image completely" },
                { status: 500 }
              );
            }
          }

          return c.json(
            {
              url: publicUrl,
              fileName: fileName,
            },
            { status: 200 }
          );
        } catch (error) {
          console.error("R2 upload error:", error);
          return c.json({ error: "Failed to upload image" }, { status: 500 });
        }
      } catch (error) {
        console.error("Image upload error:", error);
        return c.json(
          { error: "Error processing or uploading image" },
          { status: 500 }
        );
      }
    }
  )
  .delete("/blogs/:blog_id/images/:file_name", async (c) => {
    try {
      const blogId = c.req.param("blog_id");
      const fileName = c.req.param("file_name");

      // Check if the user owns the blog
      const { user } = await getUser();
      if (!user || !user.id) {
        return c.json({ error: "Unauthorized" }, { status: 401 });
      }

      const isOwner = await getBlogOwnership(blogId, user.id);
      if (!isOwner) {
        return c.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Delete from Supabase first
      const supabase = createClient();
      const { error: dbError } = await supabase
        .from("blog_images")
        .delete()
        .match({
          blog_id: blogId,
          file_url: `${process.env.R2_BASE_URL}/${fileName}`,
        });

      if (dbError) {
        console.error("Database delete error:", dbError);
        return c.json(
          { error: "Failed to delete image metadata" },
          { status: 500 }
        );
      }

      // Delete from R2
      const r2 = createR2Client();
      try {
        await r2.send(
          new DeleteObjectCommand({
            Bucket: process.env.R2_IMAGES_BUCKET_NAME,
            Key: fileName,
          })
        );
      } catch (r2Error) {
        console.error("R2 delete error:", r2Error);
        axiom.ingest(AXIOM_DATASETS.api, {
          message: "Failed to delete R2 image",
          fileName,
          blogId,
          error: true,
          r2Error,
        });
        return c.json(
          { error: "Failed to delete image from storage" },
          { status: 500 }
        );
      }

      return c.json({ message: "Image deleted successfully" }, { status: 200 });
    } catch (error) {
      console.error("Image deletion error:", error);
      return c.json({ error: "Error deleting image" }, { status: 500 });
    }
  });

const app = new Hono()
  .basePath("/api")
  // MIDDLEWARE
  .use("*", logger())
  .use("*", prettyJSON())
  // ROUTES
  .route("/v2", api);

export type ManagementAPI = typeof app;

export const OPTIONS = handle(app);
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
