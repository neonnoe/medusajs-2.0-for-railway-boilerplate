// src/workflows/order/send-order-confirmation.ts
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { sendNotificationStep } from "./shared/steps/send-notification"
import { MedusaError } from "@medusajs/framework/utils"

type WorkflowInput = { id: string }

export const sendOrderConfirmationWorkflow = createWorkflow(
  "send-order-confirmation",
  ({ id }: WorkflowInput) => {
    // 1) Load order
    // @ts-ignore
    const { data: orders } = useQueryGraphStep({
      entity: "order",
      fields: [
        "id",
        "created_at",
        "display_id",
        "email",
        "currency_code",
        "shipping_subtotal",
        "shipping_tax_total",
        "shipping_total",
        "subtotal",
        "tax_total",
        "total",
        "item_total",
        "shipping_address.*",
        "billing_address.*",
        "metadata.language",
        "items.*",
      ],
      filters: { id },
      options: { throwIfKeyNotFound: true },
    })

    // 2) Extract email
    const email = transform({ orders }, ({ orders }) => {
      const o = orders![0]
      if (!o?.email) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Order ${o?.id || id} is missing an email address.`
        )
      }
      return o.email
    })

    // 3) Determine template alias
    const templateAlias = transform({ orders }, ({ orders }) => {
      const lang = orders![0].metadata?.language === "de" ? "de" : "en"
      return `order-confirmation-${lang}`
    })

    // 4) Get raw order object
    const orderData = transform({ orders }, ({ orders }) => {
      const o = orders![0]
      if (!o) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Order ${id} not found after query.`
        )
      }
      
      // Log the address structures for debugging
      console.log("Billing Address:", JSON.stringify(o.billing_address, null, 2));
      console.log("Shipping Address:", JSON.stringify(o.shipping_address, null, 2));
      
      return o
    })

    // 5) Formatiere alle Preise – auch innerhalb der Items
    // @ts-ignore - Complex union type
    const formattedOrder = transform({ orderData }, ({ orderData }) => {
      const currency = orderData.currency_code.toUpperCase()
      const locale   = currency === "EUR" ? "de-DE" : "en-US"
      const fmt      = new Intl.NumberFormat(locale, {
        style:                "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })

      return {
        ...orderData,
        // Keep original values and add formatted versions
        formatted_subtotal:           fmt.format(orderData.subtotal),
        formatted_tax_total:          fmt.format(orderData.tax_total),
        formatted_total:              fmt.format(orderData.total),
        formatted_shipping_subtotal:  fmt.format(orderData.shipping_subtotal),
        formatted_shipping_tax_total: fmt.format(orderData.shipping_tax_total),
        formatted_shipping_total:     fmt.format(orderData.shipping_total),
        formatted_item_total:         fmt.format(orderData.item_total ?? 0),

        // 5b) Check items array and individual items before mapping
        items: (orderData.items || []).map((i) => {
          if (!i) return null; // Skip null items in the array
          
          // Format item prices, providing 0 as fallback if null/undefined
          return {
            ...i,
            formatted_unit_price:     fmt.format(i.unit_price ?? 0),
            formatted_total:          fmt.format(i.total ?? 0),
            formatted_original_total: fmt.format(i.original_total ?? 0),
            formatted_discount_total: fmt.format(i.discount_total ?? 0),
          };
        }).filter(item => item !== null), // Filter out any null items
      }
    })

    // 6) Send notification
    const notification = sendNotificationStep([
      {
        to: email,
        channel: "email",
        template: templateAlias,
        data: {
          order: formattedOrder,  // <-- hier das formatierte Order-Objekt
        },
      },
    ])

    return new WorkflowResponse(notification)
  }
)
