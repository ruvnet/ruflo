# E-Commerce Checkout Flow Requirements

## Objective
Build a complete e-commerce checkout system with shopping cart, payment processing, and order management.

## Features Required

### 1. Shopping Cart API (Express + PostgreSQL)
- Add items to cart
- Remove items from cart
- Update item quantities
- Calculate totals with tax (8.5% sales tax)
- Apply discount codes (10% off for "SAVE10")

### 2. Checkout Process
- Collect shipping address (street, city, state, zip)
- Payment method selection
- Stripe payment integration (test mode)
- Order confirmation with order ID

### 3. Frontend UI (React + TypeScript)
- Cart summary component (shows items, quantities, subtotal, tax, total)
- Multi-step checkout form
  - Step 1: Review cart
  - Step 2: Shipping address
  - Step 3: Payment details
  - Step 4: Order confirmation
- Responsive design (mobile-friendly)

### 4. Testing (Jest + Cypress)
- Unit tests for all API endpoints (90%+ coverage)
- Unit tests for cart calculations
- Integration tests (API → UI flow)
- E2E tests (complete checkout flow)

## Technical Stack
- **Backend**: Express + PostgreSQL
- **Frontend**: React + TypeScript
- **Testing**: Jest + Cypress
- **Quality**: ESLint, TypeScript strict mode
- **Payment**: Stripe (test mode keys)

## Database Schema
- `products` table: id, name, price, description
- `carts` table: id, user_id, created_at
- `cart_items` table: id, cart_id, product_id, quantity
- `orders` table: id, cart_id, total, status, created_at
- `shipping_addresses` table: id, order_id, street, city, state, zip

## API Endpoints
- `POST /api/cart` - Create new cart
- `POST /api/cart/:id/items` - Add item to cart
- `DELETE /api/cart/:id/items/:itemId` - Remove item
- `PUT /api/cart/:id/items/:itemId` - Update quantity
- `GET /api/cart/:id` - Get cart with totals
- `POST /api/cart/:id/checkout` - Process checkout
- `POST /api/orders/:id/payment` - Process Stripe payment

## Success Criteria
- [ ] All features working end-to-end
- [ ] 90%+ test coverage
- [ ] 0 TypeScript errors
- [ ] 0 ESLint errors
- [ ] Payment flow secure (no PII in logs)
- [ ] All API contracts documented
- [ ] Database migrations included
- [ ] README with setup instructions
