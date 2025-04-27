import { loadEnv, Modules, defineConfig } from '@medusajs/utils';
import {
  ADMIN_CORS,
  AUTH_CORS,
  BACKEND_URL,
  COOKIE_SECRET,
  DATABASE_URL,
  JWT_SECRET,
  REDIS_URL,
  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  SENDGRID_API_KEY,
  SENDGRID_FROM_EMAIL,
  SHOULD_DISABLE_ADMIN,
  STORE_CORS,
  STRIPE_API_KEY,
  STRIPE_WEBHOOK_SECRET,
  WORKER_MODE,
  // MINIO_ENDPOINT,
  // MINIO_ACCESS_KEY,
  // MINIO_SECRET_KEY,
  // MINIO_BUCKET,
    // Neue DO Spaces-Variablen:
  SPACES_ENDPOINT,
  SPACES_REGION,
  SPACES_BUCKET,
  SPACES_PUBLIC_URL,
  SPACES_ACCESS_KEY_ID,
  SPACES_SECRET_ACCESS_KEY,
  MEILISEARCH_HOST,
  MEILISEARCH_ADMIN_KEY,
  POSTMARK_API_KEY,
  POSTMARK_FROM_EMAIL
} from 'lib/constants';

loadEnv(process.env.NODE_ENV, process.cwd());

const medusaConfig = {
  projectConfig: {
    databaseUrl: DATABASE_URL,
    databaseLogging: false,
    redisUrl: REDIS_URL,
    workerMode: WORKER_MODE,
    http: {
      adminCors: ADMIN_CORS,
      authCors: AUTH_CORS,
      storeCors: STORE_CORS,
      jwtSecret: JWT_SECRET,
      cookieSecret: COOKIE_SECRET
    }
  },
  admin: {
    backendUrl: BACKEND_URL,
    disable: SHOULD_DISABLE_ADMIN,
  },
  modules: [
    {
      key: Modules.FILE,
      resolve: '@medusajs/file',
      options: {
        providers: [
          // DO Spaces / S3-kompatibel
          ...(SPACES_ENDPOINT &&
          SPACES_REGION &&
          SPACES_BUCKET &&
          SPACES_PUBLIC_URL &&
          SPACES_ACCESS_KEY_ID &&
          SPACES_SECRET_ACCESS_KEY
            ? [{
                resolve: '@medusajs/medusa/file-s3',
                id: 'spaces',
                options: {
                  endpoint: SPACES_ENDPOINT,        // z.B. "https://nyc3.digitaloceanspaces.com"
                  region: SPACES_REGION,           // z.B. "nyc3"
                  bucket: SPACES_BUCKET,           // dein Bucket-Name
                  file_url: SPACES_PUBLIC_URL,     // z.B. "https://your-bucket.nyc3.digitaloceanspaces.com"
                  access_key_id: SPACES_ACCESS_KEY_ID,
                  secret_access_key: SPACES_SECRET_ACCESS_KEY,
                  // optional:
                  // prefix: 'media',
                  // aws_config: { s3ForcePathStyle: true },
                },
              }]
            : []),
        ],
        // providers: [
        //   ...(MINIO_ENDPOINT && MINIO_ACCESS_KEY && MINIO_SECRET_KEY ? [{
        //     resolve: './src/modules/minio-file',
        //     id: 'minio',
        //     options: {
        //       endPoint: MINIO_ENDPOINT,
        //       accessKey: MINIO_ACCESS_KEY,
        //       secretKey: MINIO_SECRET_KEY,
        //       bucket: MINIO_BUCKET // Optional, default: medusa-media
        //     }
        //   }] : [{
        //     resolve: '@medusajs/file-local',
        //     id: 'local',
        //     options: {
        //       upload_dir: 'static',
        //       backend_url: `${BACKEND_URL}/static`
        //     }
        //   }])
        // ]
      }
    },
    ...(REDIS_URL ? [{
      key: Modules.EVENT_BUS,
      resolve: '@medusajs/event-bus-redis',
      options: {
        redisUrl: REDIS_URL
      }
    },
    {
      key: Modules.WORKFLOW_ENGINE,
      resolve: '@medusajs/workflow-engine-redis',
      options: {
        redis: {
          url: REDIS_URL,
        }
      }
    }] : []),
    ...(SENDGRID_API_KEY && SENDGRID_FROM_EMAIL || RESEND_API_KEY && RESEND_FROM_EMAIL || POSTMARK_API_KEY && POSTMARK_FROM_EMAIL ? [{
      key: Modules.NOTIFICATION,
      resolve: '@medusajs/notification',
      options: {
        providers: [
          // SendGrid
          ...(SENDGRID_API_KEY && SENDGRID_FROM_EMAIL ? [{
            resolve: '@medusajs/notification-sendgrid',
            id: 'sendgrid',
            options: {
              channels: ['email'],
              api_key: SENDGRID_API_KEY,
              from: SENDGRID_FROM_EMAIL,
            }
          }] : []),
          // Resend
          ...(RESEND_API_KEY && RESEND_FROM_EMAIL ? [{
            resolve: './src/modules/email-notifications',
            id: 'resend',
            options: {
              channels: ['email'],
              api_key: RESEND_API_KEY,
              from: RESEND_FROM_EMAIL,
            },
          }] : []),
          // Postmark
          ...(POSTMARK_API_KEY && POSTMARK_FROM_EMAIL ? [{
            resolve: './src/modules/postmark',
            id: 'postmark',
            options: {
              channels: ['email'],
              api_key: POSTMARK_API_KEY,
              from: POSTMARK_FROM_EMAIL,
            },
          }] : []),
        ]
      }
    }] : []),
    ...(STRIPE_API_KEY && STRIPE_WEBHOOK_SECRET ? [{
      key: Modules.PAYMENT,
      resolve: '@medusajs/payment',
      options: {
        providers: [
          {
            resolve: '@medusajs/payment-stripe',
            id: 'stripe',
            options: {
              apiKey: STRIPE_API_KEY,
              webhookSecret: STRIPE_WEBHOOK_SECRET,
              capture: true, // 👈 automatisch erfassen
            },
          },
        ],
      },
    }] : [])
  ],
  plugins: [
  ...(MEILISEARCH_HOST && MEILISEARCH_ADMIN_KEY ? [{
      resolve: '@rokmohar/medusa-plugin-meilisearch',
      options: {
        config: {
          host: MEILISEARCH_HOST,
          apiKey: MEILISEARCH_ADMIN_KEY
        },
        settings: {
          products: {
            indexSettings: {
              searchableAttributes: ['title', 'description', 'variant_sku'],
              displayedAttributes: ['id', 'title', 'description', 'variant_sku', 'thumbnail', 'handle'],
            },
            primaryKey: 'id',
          }
        }
      }
    }] : [])
  ]
};

console.log(JSON.stringify(medusaConfig, null, 2));
export default defineConfig(medusaConfig);
