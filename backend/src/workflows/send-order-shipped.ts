import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { sendNotificationStep } from "./shared/steps/send-notification"
import { MedusaError } from "@medusajs/framework/utils"

type WorkflowInput = { 
  id: string,
  tracking_number?: string, 
  tracking_url?: string,
  carrier?: string
}

export const sendOrderShippedWorkflow = createWorkflow(
  "send-order-shipped",
  // Match exactly the same argument format as the order confirmation workflow
  function(input: WorkflowInput) {
    const { id, tracking_number, tracking_url, carrier } = input
    
    // 1) Load order with fulfillment data
    // @ts-ignore - Needed for useQueryGraphStep
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
        "fulfillments.id",
        "fulfillments.tracking_numbers",
        "fulfillments.tracking_links",
        "fulfillments.shipped_at",
        "fulfillments.labels",  // Wichtig: Wir holen das ganze labels-Objekt statt labels.*
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
      return `order-shipped-${lang}`
    })

    // 4) Process and prepare the order object
    const orderData = transform({ orders }, ({ orders }) => {
      const o = orders![0]
      if (!o) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Order ${id} not found after query.`
        )
      }
      
      const safeLog = (...args: any[]) => {
        try {
          if (typeof console !== 'undefined' && console && typeof console.log === 'function') {
            console.log(...args);
          }
        } catch (error) {
          // Silently ignore logging errors
        }
      };
      
      const getStringValue = (value: any): string => {
        if (typeof value === 'string') return value;
        if (value && typeof value.toString === 'function') {
          const str = value.toString();
          if (str !== '[object Object]') return str;
        }
        return '';
      };

      // Initialize tracking object on the order using workflow inputs as defaults
      // @ts-ignore - Dynamically adding tracking to order
      o.tracking = {
        number: getStringValue(tracking_number), // from workflow input
        url: getStringValue(tracking_url),       // from workflow input
        carrier: getStringValue(carrier)         // from workflow input
      };
      
      safeLog(`Initial tracking from input: ${JSON.stringify(o.tracking)}`);
      safeLog(`Initial order object (before fulfillment processing): ${JSON.stringify(o, null, 2)}`);

      if (o.fulfillments && Array.isArray(o.fulfillments) && o.fulfillments.length > 0) {
        safeLog(`Processing ${o.fulfillments.length} fulfillments for order ${o.id}`);
        
        const primaryFulfillment = o.fulfillments[0];
        
        if (primaryFulfillment) {
          safeLog(`Primary fulfillment: ${JSON.stringify(primaryFulfillment, null, 2)}`);
          
          // Try to get tracking info from labels ONLY if not already set by workflow input
          if (primaryFulfillment.labels && Array.isArray(primaryFulfillment.labels) && primaryFulfillment.labels.length > 0) {
            const firstLabel = primaryFulfillment.labels[0];
            if (firstLabel) {
              safeLog(`First label data: ${JSON.stringify(firstLabel, null, 2)}`);
              
              // @ts-ignore
              if (!o.tracking.number && firstLabel.tracking_number) {
                // @ts-ignore
                o.tracking.number = getStringValue(firstLabel.tracking_number);
                // @ts-ignore
                safeLog(`Updated tracking number from label: ${o.tracking.number}`);
              }
              // @ts-ignore
              if (!o.tracking.url && firstLabel.tracking_url) {
                // @ts-ignore
                o.tracking.url = getStringValue(firstLabel.tracking_url);
                // @ts-ignore
                safeLog(`Updated tracking URL from label: ${o.tracking.url}`);
              }
              // @ts-ignore - label_url is also a possibility
              // @ts-ignore
              if (!o.tracking.url && firstLabel.label_url) {
                // @ts-ignore
                o.tracking.url = getStringValue(firstLabel.label_url);
                // @ts-ignore
                safeLog(`Updated tracking URL from label_url: ${o.tracking.url}`);
              }
            }
          } else {
            safeLog(`No labels found on primary fulfillment.`);
          }

          // Fallback to direct tracking_numbers/links if o.tracking is still empty
          // @ts-ignore
          if (!o.tracking.number && primaryFulfillment.tracking_numbers && Array.isArray(primaryFulfillment.tracking_numbers) && primaryFulfillment.tracking_numbers.length > 0) {
            // @ts-ignore
            o.tracking.number = getStringValue(primaryFulfillment.tracking_numbers[0]);
            // @ts-ignore
            safeLog(`Updated tracking number from fulfillment.tracking_numbers: ${o.tracking.number}`);
          }
          // @ts-ignore
          if (!o.tracking.url && primaryFulfillment.tracking_links && Array.isArray(primaryFulfillment.tracking_links) && primaryFulfillment.tracking_links.length > 0) {
            // @ts-ignore
            o.tracking.url = getStringValue(primaryFulfillment.tracking_links[0]);
            // @ts-ignore
            safeLog(`Updated tracking URL from fulfillment.tracking_links: ${o.tracking.url}`);
          }
        }
      }
      
      // Ensure fulfillments also have a clear labels array for the template
      if (o.fulfillments && Array.isArray(o.fulfillments)) {
        o.fulfillments.forEach(fulfillment => {
          if (!fulfillment) return;
          
          if (!fulfillment.labels || !Array.isArray(fulfillment.labels) || fulfillment.labels.length === 0) {
            // @ts-ignore
            fulfillment.labels = [{
              id: 'derived_label',
              // @ts-ignore
              tracking_number: o.tracking.number,
              // @ts-ignore
              tracking_url: o.tracking.url
            }];
            safeLog(`Created derived label for fulfillment ${fulfillment.id} using: Number=${o.tracking.number}, URL=${o.tracking.url}`);
          } else {
            fulfillment.labels.forEach(label => {
              if (label) {
                // @ts-ignore
                label.tracking_number = getStringValue(label.tracking_number || o.tracking.number); // Ensure string, fallback to order tracking
                // @ts-ignore
                label.tracking_url = getStringValue(label.tracking_url || o.tracking.url);     // Ensure string, fallback to order tracking
              }
            });
          }
        });
      }
      
      safeLog("Final prepared order data for template:", 
        // @ts-ignore
        JSON.stringify({ id: o.id, display_id: o.display_id, tracking: o.tracking, fulfillments: o.fulfillments.map(f => ({id: f.id, labels: f.labels})) }, null, 2)
      );
      
      return o
    })

    // 5) Format prices
    // @ts-ignore - Complex union type
    const formattedOrder = transform({ orderData }, ({ orderData }) => {
      const currency = orderData.currency_code.toUpperCase()
      const locale = currency === "EUR" ? "de-DE" : "en-US"
      const fmt = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })

      return {
        ...orderData,
        // Format currency values
        formatted_subtotal: fmt.format(orderData.subtotal),
        formatted_tax_total: fmt.format(orderData.tax_total),
        formatted_total: fmt.format(orderData.total),
        formatted_shipping_subtotal: fmt.format(orderData.shipping_subtotal),
        formatted_shipping_tax_total: fmt.format(orderData.shipping_tax_total),
        formatted_shipping_total: fmt.format(orderData.shipping_total),
        formatted_item_total: fmt.format(orderData.item_total ?? 0),

        // Format items
        items: (orderData.items || []).map((i) => {
          if (!i) return null; 
          
          return {
            ...i,
            formatted_unit_price: fmt.format(i.unit_price ?? 0),
            formatted_total: fmt.format(i.total ?? 0),
            formatted_original_total: fmt.format(i.original_total ?? 0),
            formatted_discount_total: fmt.format(i.discount_total ?? 0),
          };
        }).filter(item => item !== null),
      }
    })

    // 6) Send notification
    const notification = sendNotificationStep([
      {
        to: email,
        channel: "email",
        template: templateAlias,
        data: {
          order: formattedOrder,
        },
      },
    ])

    return new WorkflowResponse(notification)
  }
) 