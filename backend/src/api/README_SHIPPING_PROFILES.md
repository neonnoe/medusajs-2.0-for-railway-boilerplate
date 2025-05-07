# Custom Store Shipping Options Logic

This implementation controls which shipping options are presented to the user based on the contents of their cart, ensuring only the single, most appropriate (highest priority/most expensive) shipping option is returned.

## How It Works

### Product Types & Shipping Option Names

The system relies on **Product Types** assigned to your products in Medusa (e.g., "Electric Bass", "Electric Guitar", "Merchandise") and the **Names** of your configured **Shipping Options** (e.g., "Electric Bass", "Electric Guitar", "Merchandise", "Default Shipping Profile", "Standard Shipping").

### Priority Logic

When a customer adds items to their cart, the custom API route (`GET /store/shipping-options`) determines the appropriate shipping option based on the product types present, following this priority:

1.  If any product with type **"Electric Bass"** is in the cart → select the shipping option named **"Electric Bass"**.
2.  Else if any product with type **"Electric Guitar"** is in the cart → select the shipping option named **"Electric Guitar"**.
3.  Else if any product with type **"Merchandise"** is in the cart → select the shipping option named **"Merchandise"**.
4.  Else (if none of the above product types are present, or the corresponding shipping option name isn't found) → try to select the shipping option named **"Default Shipping Profile"**.
5.  Else (if "Default Shipping Profile" isn't found) → try to select the shipping option named **"Standard Shipping"**.
6.  Else (if none of the specific names match an available option) → select the single **most expensive** shipping option available for the cart.

The API endpoint then returns only the **one** selected shipping option.

## Implementation Details

The core logic resides in the custom API route handler:
`src/api/store/shipping-options/route.ts`

This route handler performs the following steps:

1.  Fetches the cart with minimal item details (`relations: ["items"]`).
2.  Collects unique product IDs from the cart items.
3.  Batch-fetches product details (specifically `type` information) for those IDs.
    *(Note: This separate fetch is a workaround for potential instability observed when fetching deep relations like `items.variant.product.type` directly on the cart).*
4.  Determines the set of unique product types present in the cart.
5.  Invokes the `listShippingOptionsForCartWithPricingWorkflow` to get all potentially applicable, priced shipping options for the cart.
6.  Applies the priority logic described above to filter the results down to a single target shipping option name (or determines fallback is needed).
7.  Filters the options returned by the workflow based on the target name or fallback rules.
8.  If multiple options remain after fallback (e.g., if the final fallback to "all options" was triggered), it selects the most expensive one based on the `amount`.
9.  Returns a JSON response containing only the single selected shipping option in the `shipping_options` array.

## Setup and Configuration

To use this feature:

1.  Ensure your products have the correct **Product Type** assigned in Medusa (e.g., "Electric Bass", "Electric Guitar", "Merchandise").
2.  Ensure you have **Shipping Options** configured in Medusa with names that exactly match those used in the priority logic and mapping within the code:
    *   "Electric Bass"
    *   "Electric Guitar"
    *   "Merchandise"
    *   "Default Shipping Profile" (or update the `defaultShippingOptionName` constant in the code if your default has a different name).
    *   "Standard Shipping" (if you want this specific fallback name).
3.  Ensure these shipping options are associated with the correct Shipping Profiles and Service Zones to be applicable to your products and regions.
4.  The rates for these shipping options should be configured correctly, as the logic relies on the `amount` returned by the pricing workflow.

## Troubleshooting

If the expected shipping option isn't being returned:

1.  Check the server console logs for errors or informative messages from the API route handler (`console.info`, `console.warn`, `console.error`).
2.  Verify that products in the cart have the correct **Product Type** assigned.
3.  Verify that the **Shipping Option Names** in Medusa exactly match those used in the `typeToShippingOptionNameMap` and `defaultShippingOptionName` / fallback checks within `src/api/store/shipping-options/route.ts`. Case sensitivity matters.
4.  Ensure the relevant shipping options are enabled, applicable to the cart's region/zone, and associated with the correct shipping profiles for the products.
5.  Test with different cart combinations to ensure the priority and fallback logic works as expected.
6.  Confirm the `listShippingOptionsForCartWithPricingWorkflow` is functioning correctly and returning priced options. 