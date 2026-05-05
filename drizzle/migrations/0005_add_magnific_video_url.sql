-- Permanent record of the original Magnific signed URL, kept even after
-- the R2 mirror lifecycle deletes the customer-facing copy. Lets admin
-- re-mirror or audit the source after 6h, and gives us a fallback if
-- R2 itself ever has an outage.
ALTER TABLE "usage_logs" ADD COLUMN "magnific_video_url" text;
