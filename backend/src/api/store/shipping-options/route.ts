import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import {
  Modules,
} from "@medusajs/framework/utils";
import { listShippingOptionsForCartWithPricingWorkflow } from "@medusajs/medusa/core-flows";

// Define a local interface that includes the amount property
interface PricedShippingOption {
  id: string;
  name: string;
  shipping_profile_id?: string; // Make optional if it can be null/undefined
  amount?: number; // Crucially, include amount (make optional if it might not always be present)
  data?: Record<string, unknown>;
  // Add any other properties you expect on these shipping option objects
  // For example, from your logging or other parts of Medusa:
  // price_type?: string;
  // type?: { label: string; description: string; code: string };
  // prices?: Array<{ currency_code?: string; region_id?: string; amount: number }>;
  // rules?: Array<{ attribute: string; value: string; operator: string }>;
}

/**
 * Minimal interface for FulfillmentModuleService based on usage
 */
/*
interface FulfillmentModuleService {
  // listShippingProfiles(filters?: any, config?: any): Promise<any[]>
  // listShippingOptions(filters?: any, config?: any): Promise<PricedShippingOption[]>
  // listShippingOptionsForCart(cartId: string): Promise<PricedShippingOption[]> // Method is not direct
  shippingOptionService_?: { // Added shippingOptionService_ here
    listShippingOptionsForCart(cartId: string, config?: any, context?: any): Promise<PricedShippingOption[]>; // Signature based on common patterns
    // Add other methods of shippingOptionService_ if known/needed
  };
  fulfillmentService_?: { // Added fulfillmentService_ here
    listShippingOptionsForCart(cartId: string, config?: any, context?: any): Promise<PricedShippingOption[]>;
  };
  // Add other sub-services if they are to be used e.g. fulfillmentService_
}
*/

function log(message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logMessage = data
    ? `${timestamp} - ${message}: ${JSON.stringify(data, null, 2)}\n`
    : `${timestamp} - ${message}\n`;
  // process.stdout.write(logMessage); // Comment out direct stdout writes for most logs
  // For selective logging, you can re-enable it or use console.log for specific messages below
}

export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const { cart_id } = req.query;
  const container: any = req.scope;
  console.info(`GET /store/shipping-options called for cart_id: ${cart_id}`);

  if (!cart_id || typeof cart_id !== "string") {
    console.warn("Missing or invalid cart_id query parameter");
    res.status(400).json({ error: "Missing or invalid cart_id query parameter" });
    return;
  }

  try {
    const cartModuleService = container.resolve(Modules.CART);
    const productModuleService = container.resolve(Modules.PRODUCT);

    // Fetch cart with minimal 'items' relation
    console.info(`Fetching cart ${cart_id} with minimal 'items' relation.`);
    const cart: any = await cartModuleService.cartService_.retrieve(cart_id, {
        relations: ["items"], 
    });
    console.info(`Cart ${cart_id} with 'items' relation retrieved: ${cart?.items?.length || 0} items.`);

    if (!cart) {
      console.error(`Critical error: Cart ${cart_id} could not be retrieved.`);
      res.status(404).json({ error: `Cart with ID ${cart_id} not found or unretrievable.` });
      return;
    }
    if (!cart.items || cart.items.length === 0) {
      console.info(`Cart ${cart_id} has no items, returning empty shipping options.`);
      res.status(200).json({ shipping_options: [] });
      return;
    }

    // --- Extract Product Types from Cart ---
    const productTypesInCart = new Set<string>();
    const productIdsMissingType = new Set<string>(); 

    console.info(`Collecting product IDs from cart ${cart_id} items to fetch types...`);
    for (const item of cart.items) {
        if (item.product_id) {
            productIdsMissingType.add(item.product_id);
        } else {
            console.warn(`Item ${item.id} in cart ${cart_id} is missing product_id.`);
        }
    }

    if (productIdsMissingType.size > 0) {
        console.info(`Fetching types for ${productIdsMissingType.size} products by batch from cart ${cart_id}:`, { ids: Array.from(productIdsMissingType) });
        const uniqueProductIdsToFetch = Array.from(productIdsMissingType);
        try {
            const fetchedProducts = await productModuleService.productService_.list(
                { id: uniqueProductIdsToFetch },
                { select: ["id", "type_id"], relations: ["type"] } 
            );
            for (const fetchedProduct of fetchedProducts) {
                const typeValue = fetchedProduct.type?.value; 
                if (typeValue) {
                    productTypesInCart.add(typeValue);
                }
            }
        } catch (batchFetchError) {
            console.warn(`Error batch fetching product types for cart ${cart_id}: ${batchFetchError.message}`);
        }
    }

    console.info(`Final product types in cart ${cart_id}:`, Array.from(productTypesInCart));

    // --- Determine Priority Shipping Option Names based on Product Types ---
    const priorityOptionNames: string[] = [];
    const typeToShippingOptionNameMap: Record<string, string> = {
        "Electric Bass": "Electric Bass",
        "Electric Guitar": "Electric Guitar",
        "Merchandise": "Merchandise"
    };
    const defaultShippingOptionName = "Standard Shipping"; 

    // Add shipping options for ALL product types in priority order
    // Electric Bass takes highest priority, then Guitar, then Merchandise
    if (productTypesInCart.has("Electric Bass")) {
        priorityOptionNames.push("Electric Bass");
    }
    if (productTypesInCart.has("Electric Guitar")) {
        priorityOptionNames.push("Electric Guitar");
    }
    if (productTypesInCart.has("Merchandise")) {
        priorityOptionNames.push("Merchandise");
    }

    // If no specific shipping options are found, add the default
    if (priorityOptionNames.length === 0) {
        priorityOptionNames.push(defaultShippingOptionName);
    }

    console.info(`Priority shipping option names for cart ${cart_id}: ${priorityOptionNames.join(', ')}`);

    // Get all available shipping options for the cart
    const { result: shippingOptionsForCart, errors: workflowErrors } = await listShippingOptionsForCartWithPricingWorkflow(
      container
    ).run({
      input: { cart_id: cart.id },
    });

    if (workflowErrors && workflowErrors.length > 0) {
      console.error(`Errors from listShippingOptionsForCartWithPricingWorkflow for cart ${cart_id}:`, workflowErrors);
      res.status(500).json({ error: "Failed to retrieve shipping options due to workflow errors.", details: workflowErrors });
      return;
    }
    console.info(`Workflow for cart ${cart_id} returned ${shippingOptionsForCart?.length || 0} options.`);

    if (!shippingOptionsForCart || shippingOptionsForCart.length === 0) {
      res.status(200).json({ shipping_options: [] });
      return;
    }

    // --- Select the most appropriate shipping option based on priority ---
    let selectedOption: PricedShippingOption | null = null;

    // Try to find options in priority order
    for (const optionName of priorityOptionNames) {
        const options = shippingOptionsForCart.filter(option => option.name === optionName);
        if (options.length > 0) {
            // If there are multiple options with the same name (from different regions),
            // select the most expensive one
            let mostExpensiveOption = options[0];
            for (let i = 1; i < options.length; i++) {
                if ((options[i].amount || 0) > (mostExpensiveOption.amount || 0)) {
                    mostExpensiveOption = options[i];
                }
            }
            selectedOption = mostExpensiveOption;
            console.info(`Selected priority option "${optionName}" with amount ${selectedOption?.amount || 0}`);
            break; // We found our option, so stop looking
        }
    }

    // If no priority option was found, fall back to any available option (most expensive)
    if (!selectedOption && shippingOptionsForCart.length > 0) {
        let mostExpensiveOption = shippingOptionsForCart[0];
        for (let i = 1; i < shippingOptionsForCart.length; i++) {
            if ((shippingOptionsForCart[i].amount || 0) > (mostExpensiveOption.amount || 0)) {
                mostExpensiveOption = shippingOptionsForCart[i];
            }
        }
        selectedOption = mostExpensiveOption;
        console.info(`No priority option found, selected most expensive option "${mostExpensiveOption.name}" with amount ${mostExpensiveOption.amount || 0}`);
    }

    // Return the selected option
    if (selectedOption) {
        console.info(`Final shipping option for cart ${cart_id}: ${selectedOption.name} (ID: ${selectedOption.id}, Amount: ${selectedOption.amount || 0})`);
        res.status(200).json({ shipping_options: [selectedOption] });
    } else {
        console.info(`No suitable shipping options available for cart ${cart_id}, returning empty.`);
        res.status(200).json({ shipping_options: [] });
    }

  } catch (error) {
    console.error(`Full error object in GET /store/shipping-options for cart ${cart_id}:`, error);
    if (error instanceof Error && error.message && error.message.includes("not found")) {
        res.status(404).json({ error: error.message });
    } else {
        res.status(500).json({ error: "Internal server error while fetching shipping options" });
    }
  }
} 