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
  // Use console.info for important operational logs that should ideally appear
  console.info(`GET /store/shipping-options called for cart_id: ${cart_id}`);

  if (!cart_id || typeof cart_id !== "string") {
    console.warn("Missing or invalid cart_id query parameter"); // Keep as warning
    res.status(400).json({ error: "Missing or invalid cart_id query parameter" });
    return;
  }

  try {
    const cartModuleService = container.resolve(Modules.CART);
    const productModuleService = container.resolve(Modules.PRODUCT);

    // Directly fetch cart with minimal 'items' relation
    // This avoids the failing attempts with deeper relations and their warnings.
    console.info(`Fetching cart ${cart_id} with minimal 'items' relation.`);
    const cart: any = await cartModuleService.cartService_.retrieve(cart_id, {
        relations: ["items"], 
    });
    console.info(`Cart ${cart_id} with 'items' relation retrieved: ${cart?.items?.length || 0} items.`);

    if (!cart) {
      console.error(`Critical error: Cart ${cart_id} could not be retrieved.`); // Keep as error
      res.status(404).json({ error: `Cart with ID ${cart_id} not found or unretrievable.` });
      return;
    }
    if (!cart.items || cart.items.length === 0) {
      // log("Cart has no items, returning empty shipping options."); // Can be removed or made console.info
      console.info(`Cart ${cart_id} has no items, returning empty shipping options.`);
      res.status(200).json({ shipping_options: [] });
      return;
    }

    // --- Extract Product Types from Cart ---
    const productTypesInCart = new Set<string>();
    const productIdsMissingType = new Set<string>(); 

    // Since we only fetch 'items' for the cart, we will always need to get product details if items exist.
    // The original loop tried to access item.variant.product.type, which won't be there with minimal relations.
    // We will collect all product_ids from items and then batch fetch them.

    console.info(`Collecting product IDs from cart ${cart_id} items to fetch types...`);
    for (const item of cart.items) {
        if (item.product_id) { // product_id should be directly on the item from the minimal cart fetch
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
            // log("Batch fetched products for missing types:", { fetchedProducts }); // Remove
            for (const fetchedProduct of fetchedProducts) {
                const typeValue = fetchedProduct.type?.value; 
                if (typeValue) {
                    productTypesInCart.add(typeValue);
                    // log(`Added type '${typeValue}' for product ${fetchedProduct.id} from batch fetch.`); // Remove
                } else {
                    // log(`Type value still missing for product ${fetchedProduct.id} after batch fetch. Product Type Object:`, { productTypeObj: fetchedProduct.type }); // Remove
                }
            }
        } catch (batchFetchError) {
            console.warn(`Error batch fetching product types for cart ${cart_id}: ${batchFetchError.message}`); // Keep as warning
        }
    }

    console.info(`Final product types in cart ${cart_id}:`, Array.from(productTypesInCart)); // Keep as info

    // --- Determine Target Shipping Option Name based on Product Type Priority ---
    let targetShippingOptionName: string | null = null;
    const typeToShippingOptionNameMap: Record<string, string> = {
        "Electric Bass": "Electric Bass",
        "Electric Guitar": "Electric Guitar",
        "Merchandise": "Merchandise"
    };
    const defaultShippingOptionName = "Default Shipping Profile"; 

    if (productTypesInCart.has("Electric Bass")) {
        targetShippingOptionName = typeToShippingOptionNameMap["Electric Bass"];
    } else if (productTypesInCart.has("Electric Guitar")) {
        targetShippingOptionName = typeToShippingOptionNameMap["Electric Guitar"];
    } else if (productTypesInCart.has("Merchandise")) {
        targetShippingOptionName = typeToShippingOptionNameMap["Merchandise"];
    }

    console.info(`Target shipping option name for cart ${cart_id} (based on product types): ${targetShippingOptionName || 'None (will use default)'}`); // Keep as info

    const workflowInput = { cart_id: cart.id };
    // log("Invoking listShippingOptionsForCartWithPricingWorkflow with input:", workflowInput); // Remove
    const { result: shippingOptionsForCart, errors: workflowErrors } = await listShippingOptionsForCartWithPricingWorkflow(
      container
    ).run({
      input: workflowInput,
    });

    if (workflowErrors && workflowErrors.length > 0) {
      console.error(`Errors from listShippingOptionsForCartWithPricingWorkflow for cart ${cart_id}:`, workflowErrors); // Keep as error
      // log("Workflow execution failed with errors:", { workflowErrors }); // Redundant with console.error
      res.status(500).json({ error: "Failed to retrieve shipping options due to workflow errors.", details: workflowErrors });
      return;
    }
    // log("Raw shipping options from workflow:", { shippingOptionsForCart }); // Too verbose
    console.info(`Workflow for cart ${cart_id} returned ${shippingOptionsForCart?.length || 0} options.`); // Keep as info

    if (!shippingOptionsForCart || shippingOptionsForCart.length === 0) {
      // log("No shipping options returned by workflow"); // Covered by console.info above if length is 0
      res.status(200).json({ shipping_options: [] });
      return;
    }

    // --- Filter Shipping Options by Name (and fallback to Default) ---
    let finalShippingOptions: PricedShippingOption[] = [];
    if (targetShippingOptionName) {
        finalShippingOptions = shippingOptionsForCart.filter(option => option.name === targetShippingOptionName);
        // log(`Filtered options by target name '${targetShippingOptionName}':`, { count: finalShippingOptions.length }); // Remove
    }

    if (finalShippingOptions.length === 0) {
        // log(`No options found for target '${targetShippingOptionName || "N/A"}'. Trying default: '${defaultShippingOptionName}'`); // Remove
        finalShippingOptions = shippingOptionsForCart.filter(option => option.name === defaultShippingOptionName);
        // log(`Filtered options by default name '${defaultShippingOptionName}':`, { count: finalShippingOptions.length }); // Remove

        if (finalShippingOptions.length === 0) { 
            // log(`Default '${defaultShippingOptionName}' not found or did not match. Trying common default: 'Standard Shipping'`); // Remove
            finalShippingOptions = shippingOptionsForCart.filter(option => option.name === "Standard Shipping");
            // log(`Filtered options by name 'Standard Shipping':`, { count: finalShippingOptions.length }); // Remove
        }
    }
    
    if (finalShippingOptions.length === 0 && shippingOptionsForCart.length > 0) {
        // log("No specific or default shipping options found by name. Falling back to all workflow options."); // Implied by next step
        finalShippingOptions = shippingOptionsForCart.map(opt => ({...opt})); 
    }

    if (finalShippingOptions.length === 0) {
        // log("No shipping options available after all filtering attempts."); // Can be console.info
        console.info(`No suitable shipping options available for cart ${cart_id} after all filtering, returning empty.`);
        res.status(200).json({ shipping_options: [] });
        return;
    }

    // --- Select Most Expensive --- 
    let mostExpensiveOption: PricedShippingOption | null = null;
    for (const option of finalShippingOptions) {
      if (
        !mostExpensiveOption ||
        (option.amount != null && mostExpensiveOption.amount != null && option.amount > mostExpensiveOption.amount) ||
        (option.amount != null && mostExpensiveOption.amount == null) 
      ) {
        mostExpensiveOption = option;
      }
    }
    
    // log("Most expensive option determined:", { mostExpensiveOption }); // Remove

    if (!mostExpensiveOption) {
      // log("Could not determine the most expensive option from the filtered list."); // Can be console.warn
      console.warn(`Could not determine most expensive option for cart ${cart_id} from filtered list, returning empty.`);
      res.status(200).json({ shipping_options: [] }); 
      return;
    }
    
    console.info(`Final shipping option for cart ${cart_id}: ${mostExpensiveOption.name} (ID: ${mostExpensiveOption.id}, Amount: ${mostExpensiveOption.amount})`); // Keep as info
    res.status(200).json({ shipping_options: [mostExpensiveOption] });

  } catch (error) {
    // Keep all existing error logging in the catch block
    console.error(`Full error object in GET /store/shipping-options for cart ${cart_id}:`, error);
    // log("Error details in GET /store/shipping-options:", { // This custom log is now less useful than the direct console.error above
    //   message: error instanceof Error ? error.message : "N/A (not an Error instance)",
    //   name: error instanceof Error ? error.name : "N/A",
    //   stack: error instanceof Error ? error.stack : "N/A",
    //   errorObjectString: String(error),
    //   errorJson: JSON.stringify(error, Object.getOwnPropertyNames(error))
    // });

    if (error instanceof Error && error.message && error.message.includes("not found")) {
        res.status(404).json({ error: error.message });
    } else {
        res.status(500).json({ error: "Internal server error while fetching shipping options" });
    }
  }
} 