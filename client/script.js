var stripe;
var allPlans = {};
var minPlansForDiscount = 2;
var discountFactor = .8;

var stripeElements = function(publicKey) {
  stripe = Stripe(publicKey);
  var elements = stripe.elements();

  // Element styles
  var style = {
    base: {
      fontSize: '16px',
      color: '#32325d',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
      fontSmoothing: 'antialiased',
      '::placeholder': {
        color: 'rgba(0,0,0,0.4)'
      }
    }
  };

  var card = elements.create('card', { style: style });

  card.mount('#card-element');

  // Element focus ring
  card.on('focus', function() {
    var el = document.getElementById('card-element');
    el.classList.add('focused');
  });

  card.on('blur', function() {
    var el = document.getElementById('card-element');
    el.classList.remove('focused');
  });

  document.querySelector('#submit').addEventListener('click', function(evt) {
    evt.preventDefault();
    document.querySelector('#submit').disabled = true;
    // Initiate payment
    pay(stripe, card);
  });
};

var pay = function(stripe, card) {
  var cardholderEmail = document.querySelector('#email').value;
  stripe
    .createPaymentMethod('card', card, {
      billing_details: {
        email: cardholderEmail
      }
    })
    .then(function(result) {
      if (result.error) {
        document.querySelector('#submit').disabled = false;
        // The card was declined (i.e. insufficient funds, card has expired, etc)
        var errorMsg = document.querySelector('.sr-field-error');
        errorMsg.textContent = result.error.message;
        setTimeout(function() {
          errorMsg.textContent = '';
        }, 4000);
      } else {
        createCustomer(result.paymentMethod.id, cardholderEmail);
      }
    });
};

var computePrice = function() {
  var selectedPlans = getSelectedPlans();
  var total = selectedPlans
    .map(plan => plan.price)
    .reduce((plan1, plan2) => plan1 + plan2, 0);
  var eligibleForDiscount = selectedPlans.length >= minPlansForDiscount;
  if (eligibleForDiscount) {
    total *= discountFactor;
  }

  return total;
}

var updatePrice = function() {
  var price = computePrice();
  document.getElementById('total-amount').innerHTML = `\$${price}`;
}

var getSelectedPlans = function() {
  return Object.values(allPlans).filter(plan => plan.selected);
}

function createCustomer(paymentMethod, cardholderEmail) {
  return fetch('/create-customer', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: cardholderEmail,
      payment_method: paymentMethod,
      plan_ids: getSelectedPlans().map(plan => plan.id)
    })
  })
    .then(response => {
      return response.json();
    })
    .then(subscription => {
      handleSubscription(subscription);
    });
}

function handleSubscription(subscription) {
  if (
    subscription &&
    subscription.latest_invoice &&
    subscription.latest_invoice.payment_intent &&
    subscription.latest_invoice.payment_intent.status === 'requires_action'
  ) {
    stripe
      .handleCardPayment(
        subscription.latest_invoice.payment_intent.client_secret
      )
      .then(function(result) {
        confirmSubscription(subscription.id);
      });
  } else if (subscription) {
    confirmSubscription(subscription.id);
    orderComplete(subscription);
  } else {
    orderComplete(subscription);
  }
}

function confirmSubscription(subscriptionId) {
  return fetch('/subscription', {
    method: 'post',
    headers: {
      'Content-type': 'application/json'
    },
    body: JSON.stringify({
      subscriptionId: subscriptionId
    })
  })
    .then(function(response) {
      return response.json();
    })
    .then(function(subscription) {
      orderComplete(subscription);
    });
}

function bootstrap() {
  return fetch('/bootstrap', {
    method: 'get',
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(function(response) {
      return response.json();
    })
    .then(function(json) {
      json.plans.forEach(function(plan) {
        plan.selected = false;
        allPlans[plan.id] = plan;
      });

      // BEGIN TEST HOOK
      var buildProductElt = function(plan) {
        var productNameElt = document.createElement('label');
        productNameElt.innerHTML = `${plan.animal}`;

        var productElt = document.createElement('div');
        productElt.classList.add('product');
        productElt.appendChild(productNameElt);
        productElt.setAttribute('planId', `${plan.id}`);
        return productElt;
      }

      var updateProductElt = function(productElt) {
        var planId = productElt.getAttribute('planId');
        var plan = allPlans[planId];
        if (plan.selected) {
          productElt.classList.add('selected');
        }
        else {
          productElt.classList.remove('selected');
        }
      }

      var togglePlan = function(planId) {
        var plan = allPlans[`${planId}`];
        plan.selected = !plan.selected;
        return plan.selected;
      }

      var handleClick = function(evt) {
        evt.preventDefault();
        var productElt = evt.currentTarget;
        var planId = productElt.getAttribute('planId');
        togglePlan(planId);
        updateProductElt(productElt);
        updatePrice();
      }

      Object.values(allPlans).forEach((plan) => {
        var productElt = buildProductElt(plan);
        document
          .getElementById('test-hook-please-ignore')
          .appendChild(productElt)
          .addEventListener('click', handleClick);
      });
      // END TEST HOOK
      generateHtmlForPlansPage();
      stripeElements(json.publicKey);
    });
}

bootstrap();

function generateHtmlForPlansPage(){
  function generateHtmlForSinglePlan(id, animal, price, url){
    result = `
      <div class="sr-animal">
        <img
          class="sr-animal-pic"
          src="https://picsum.photos/280/320?random=1"
          width="140"
          height="160"
          id=\'${id}\'
          onclick="toggleAnimal(\'${id}\')"
        />
        <div class="sr-animal-text">\'${animal}\'</div>
        <div class="sr-animal-text">$\'${price}\'</div>
      </div>
      `;
    return result;
  }
  var html = '';
  Object.keys(allPlans).forEach((planId) => {
    html += generateHtmlForSinglePlan(planId, allPlans[planId].animal, allPlans[planId].price, allPlans[planId].imageURL);
  });

  document.getElementById('test-hook-please-ignore').innerHTML += html;
}

function toggleAnimal(id){
  console.log(id);
  allPlans[id].selected = !allPlans[id].selected;
  updatePrice();
}

/* ------- Post-payment helpers ------- */

/* Shows a success / error message when the payment is complete */
var orderComplete = function(subscription) {
  var subscriptionJson = JSON.stringify(subscription, null, 2);
  document.querySelectorAll('.payment-view').forEach(function(view) {
    view.classList.add('hidden');
  });
  document.querySelectorAll('.completed-view').forEach(function(view) {
    view.classList.remove('hidden');
  });
  document.querySelector('.order-status').textContent = subscription.status;
  document.querySelector('pre').textContent = subscriptionJson;
};
