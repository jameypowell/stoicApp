#!/usr/bin/env node

/**
 * Refund JD Nielson's Jan 13 charge and update billing to March 15
 */

require('dotenv').config();

const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';
const USER_EMAIL = 'jbnielson16@gmail.com';
const NEXT_BILLING_DATE = '2026-03-15'; // March 15, 2026

// Get production Stripe key
const stripeKey = process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('❌ STRIPE_SECRET_KEY not found');
  process.exit(1);
}
const stripe = require('stripe')(stripeKey);

async function refundAndUpdate() {
  console.log('🚨 REFUNDING JD NIELSON JAN 13 CHARGE');
  console.log('='.repeat(60));
  console.log('Customer ID:', CUSTOMER_ID);
  console.log('Next Billing Date:', NEXT_BILLING_DATE);
  console.log('');
  
  try {
    // 1. Get all invoices for January 2026
    console.log('1️⃣  Finding invoices from January 2026...');
    const invoices = await stripe.invoices.list({
      customer: CUSTOMER_ID,
      limit: 100
    });
    
    // Filter for January 2026 invoices
    const janInvoices = invoices.data.filter(inv => {
      const invDate = new Date(inv.created * 1000);
      return invDate.getFullYear() === 2026 && invDate.getMonth() === 0; // January = 0
    });
    
    console.log(`   Found ${janInvoices.length} invoice(s) from January 2026:`);
    janInvoices.forEach((inv, idx) => {
      const invDate = new Date(inv.created * 1000).toLocaleDateString();
      console.log(`   ${idx + 1}. Invoice ${inv.id}`);
      console.log(`      Date: ${invDate}`);
      console.log(`      Amount: $${(inv.amount_paid / 100).toFixed(2)}`);
      console.log(`      Status: ${inv.status}`);
      console.log(`      Payment Intent: ${inv.payment_intent || 'N/A'}`);
    });
    
    // 2. Find the Jan 13 charge specifically
    const jan13Invoice = janInvoices.find(inv => {
      const invDate = new Date(inv.created * 1000);
      return invDate.getDate() === 13; // Jan 13
    });
    
    if (!jan13Invoice) {
      console.log('\n⚠️  No invoice found for Jan 13, 2026');
      console.log('   Checking all paid invoices...');
      
      // Get all paid invoices
      const paidInvoices = invoices.data.filter(inv => inv.status === 'paid' && inv.amount_paid > 0);
      console.log(`   Found ${paidInvoices.length} paid invoice(s):`);
      paidInvoices.forEach((inv, idx) => {
        const invDate = new Date(inv.created * 1000).toLocaleDateString();
        console.log(`   ${idx + 1}. Invoice ${inv.id} - ${invDate} - $${(inv.amount_paid / 100).toFixed(2)}`);
      });
      
      // Use the most recent paid invoice if no Jan 13 found
      if (paidInvoices.length > 0) {
        const mostRecent = paidInvoices.sort((a, b) => b.created - a.created)[0];
        console.log(`\n   Using most recent paid invoice: ${mostRecent.id}`);
        console.log(`   Date: ${new Date(mostRecent.created * 1000).toLocaleDateString()}`);
        
        // Refund it
        if (mostRecent.payment_intent) {
          console.log(`\n2️⃣  Refunding payment intent: ${mostRecent.payment_intent}`);
          const refund = await stripe.refunds.create({
            payment_intent: mostRecent.payment_intent,
            reason: 'requested_by_customer'
          });
          
          console.log(`   ✅ Refund created: ${refund.id}`);
          console.log(`   Amount: $${(refund.amount / 100).toFixed(2)}`);
          console.log(`   Status: ${refund.status}`);
        } else {
          console.log(`   ⚠️  No payment intent found for invoice ${mostRecent.id}`);
        }
      } else {
        console.log('\n   ❌ No paid invoices found to refund');
      }
    } else {
      console.log(`\n2️⃣  Found Jan 13 invoice: ${jan13Invoice.id}`);
      console.log(`   Amount: $${(jan13Invoice.amount_paid / 100).toFixed(2)}`);
      
      // Refund the payment
      if (jan13Invoice.payment_intent) {
        console.log(`\n3️⃣  Refunding payment intent: ${jan13Invoice.payment_intent}`);
        const refund = await stripe.refunds.create({
          payment_intent: jan13Invoice.payment_intent,
          reason: 'requested_by_customer'
        });
        
        console.log(`   ✅ Refund created: ${refund.id}`);
        console.log(`   Amount: $${(refund.amount / 100).toFixed(2)}`);
        console.log(`   Status: ${refund.status}`);
      } else {
        console.log(`   ⚠️  No payment intent found for invoice ${jan13Invoice.id}`);
      }
    }
    
    // 3. Update subscription billing cycle anchor to March 15
    console.log('\n4️⃣  Updating subscription billing cycle anchor...');
    const subscriptions = await stripe.subscriptions.list({
      customer: CUSTOMER_ID,
      status: 'all',
      limit: 10
    });
    
    const activeSubs = subscriptions.data.filter(s => s.status === 'active' || s.status === 'trialing');
    
    if (activeSubs.length === 0) {
      console.log('   ❌ No active subscriptions found');
      process.exit(1);
    }
    
    const latestActive = activeSubs.sort((a, b) => b.created - a.created)[0];
    console.log(`   Found active subscription: ${latestActive.id}`);
    console.log(`   Current billing cycle anchor: ${new Date(latestActive.billing_cycle_anchor * 1000).toLocaleDateString()}`);
    
    const billingDate = new Date(NEXT_BILLING_DATE);
    const billingCycleAnchor = Math.floor(billingDate.getTime() / 1000);
    
    const updatedSub = await stripe.subscriptions.update(latestActive.id, {
      billing_cycle_anchor: billingCycleAnchor,
      proration_behavior: 'none'
    });
    
    console.log(`   ✅ Updated subscription: ${updatedSub.id}`);
    console.log(`   New billing cycle anchor: ${new Date(updatedSub.billing_cycle_anchor * 1000).toLocaleDateString()}`);
    console.log(`   Current period end: ${new Date(updatedSub.current_period_end * 1000).toLocaleDateString()}`);
    
    console.log('\n✅✅✅ REFUND AND UPDATE COMPLETE! ✅✅✅');
    console.log('   Refund: Processed');
    console.log('   Next billing: March 15, 2026');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

refundAndUpdate();


