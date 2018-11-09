(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
'use strict';

/**
 * Based on Iamport's JavaScript SDK.
 * - Iamport's JavaScript SDK should be imported before this plugin.
 * - `IMP.init('id');` should be called before `makePayment` gets called.
 * - Website: http://iamport.kr/
 * - Guide: https://docs.iamport.kr/
 */

var RedirectionError = function RedirectionError(options) {
	var code = options.code,
	    type = options.type,
	    subject = options.subject,
	    message = options.message;


	var err = new Error(message);

	err.code = code;
	err.type = type;
	err.subject = subject;

	return err;
};

var implementation = function implementation() {
	var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
	var _options$redirectURL = options.redirectURL,
	    redirectURL = _options$redirectURL === undefined ? function (data) {

		var location = window.location;
		var type = data.subscription ? 'subscription' : 'order';

		// `?type` query is required.
		return location.protocol + '//' + location.host + '?type=' + type;
	} : _options$redirectURL,
	    _options$billingKeyNa = options.billingKeyName,
	    billingKeyName = _options$billingKeyNa === undefined ? 'Billing Key' : _options$billingKeyNa,
	    _options$orderName = options.orderName,
	    orderName = _options$orderName === undefined ? function (cart) {
		return (cart.items[0].product.name || '').slice(0, 16);
	} : _options$orderName,
	    _options$buyerName = options.buyerName,
	    buyerName = _options$buyerName === undefined ? function (customer) {
		return customer.name.full;
	} : _options$buyerName,
	    _options$buyerAddress = options.buyerAddress,
	    buyerAddress = _options$buyerAddress === undefined ? function (address) {
		return [address.address1, address.address2].filter(function (v) {
			return v;
		}).join(' ').trim();
	} : _options$buyerAddress,
	    _options$redirectionC = options.redirectionCallback,
	    redirectionCallback = _options$redirectionC === undefined ? function () {} : _options$redirectionC;

	// Handle mobile redirections automatically

	implementation.handleRedirect(redirectionCallback);

	return function () {
		var data = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
		var callback = arguments[1];
		var paymentMethod = data.paymentMethod,
		    cart = data.cart,
		    order = data.order,
		    subscription = data.subscription,
		    customer = data.customer;


		if (paymentMethod.cardFields) {
			// Since Iamport doesn't support manual payment with card information,
			// do not call `IMP.request_pay` method.
			return callback(null, {});
		}

		var subject = subscription || order;
		var address = subject.address.shipping;
		var currency = subject.currency.payment.code;

		var taxFree = cart ? implementation.calculateTaxFree(cart) : null;

		// Default request options for orders and subscriptions
		var params = $.extend({
			pg: paymentMethod.meta.pg,
			pay_method: paymentMethod.meta.payMethod,
			currency: currency,
			buyer_email: customer.email || null,
			buyer_name: buyerName(customer),
			buyer_tel: customer.mobile || customer.phone, // Required by Iamport
			buyer_addr: buyerAddress(address),
			buyer_postcode: address.postcode,
			m_redirect_url: redirectURL(data) // Set redirect URL if is needed...
		}, subscription ? {
			// Subscription case, Issue a billing key for subscriptions.
			// Reference: https://github.com/iamport/iamport-manual/tree/master/%EB%B9%84%EC%9D%B8%EC%A6%9D%EA%B2%B0%EC%A0%9C/example
			merchant_uid: subscription._id, // Set `merchant_uid` as a subscription's id
			// Billing key will be issued..
			// For a registered customer: customer._id
			// For a non-registered customer: subscription._id
			customer_uid: subscription.customer._id || subscription._id,
			name: billingKeyName, // Placeholder name
			amount: 0
		} : $.extend({
			// Regular order case.
			merchant_uid: order._id,
			name: orderName(cart),
			// Handle rich data cases.
			amount: typeof order.total.amount.raw === 'number' ? order.total.amount.raw : order.total.amount
		}, taxFree ? {
			// `tax_free` param is only supported for regular orders for now.
			tax_free: taxFree
		} : {}));

		return IMP.request_pay(params, function (res) {
			return callback(res.success ? null : res, res);
		});
	};
};

implementation.calculateTaxFree = function (cart) {

	var isZeroTaxed = function isZeroTaxed(item) {
		return item.taxed.convertedRaw === 0;
	};

	// Handle `tax_free` parameter of Iamport for tax exempted & zero-rated products.
	// Reference: https://docs.iamport.kr/tech/vat
	var itemsWithZeroTax = [].concat(
	// Zero taxed items
	cart.items.reduce(function (items, item) {
		return items.concat(item, item.bundleItems || []);
	}, []).filter(isZeroTaxed).map(function (item) {
		return item.price.withTax.convertedRaw;
	}),
	// Zero taxed shipment
	(cart.shipments || []).filter(isZeroTaxed).map(function (shipment) {
		return shipment.fee.withTax.convertedRaw;
	})).filter(function (v) {
		return v !== 0;
	}); // Just in case where an actual item/shipment's price is 0

	if (itemsWithZeroTax.length === 0) {
		// There are no zero taxed items and shipments
		return null;
	}

	// Build a sum price of tax free items and shipments.
	// It is important that we use the payment currency's precision to calculate sum.
	// Reference: https://stackoverflow.com/questions/1458633/how-to-deal-with-floating-point-number-precision-in-javascript
	var precision = cart.currency.payment.precision;

	var sum = itemsWithZeroTax.reduce(function (sum, v) {
		return sum + v;
	}, 0);

	if (precision > 0) {
		sum = parseFloat(parseFloat(sum).toPrecision(precision));
	}

	return sum;
};

implementation.handleRedirect = function (callback) {

	var Thunder = window.Thunder;
	var query = Thunder.util.urlQuery();

	var types = {
		order: true,
		subscription: true
	};

	if (types[query.type] && query.merchant_uid) {
		var success = query.imp_success,
		    type = query.type,
		    subject = query.merchant_uid;

		// Payment failure case...

		if (success !== 'true') {

			return callback(RedirectionError({
				code: 'iamport-payment',
				message: 'Failed to make a payment.',
				type: type,
				subject: subject
			}));
		}

		// Payment success case...
		if (type === 'order') {
			// Regular order case
			return callback(null, { type: type, subject: subject });
		}

		// Subscription case, we should post schedules to Iamport via Clayful's API
		return Thunder.request({
			method: 'POST',
			url: '/v1/me/subscriptions/' + subject + '/scheduled',
			data: {}
		}).then(function () {
			// Scheduling succeeded...
			return callback(null, { type: type, subject: subject });
		}, function (err) {
			// Scheduling failed...
			return callback(RedirectionError({
				code: 'clayful-schedule',
				message: 'Failed to post schedules.',
				type: type,
				subject: subject
			}));
		});
	}
};

window.ThunderMakePaymentIamport = implementation;

},{}]},{},[1])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJwbHVnaW5zL21ha2VQYXltZW50L2lhbXBvcnQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBOzs7Ozs7OztBQVFBLElBQU0sbUJBQW1CLFNBQW5CLGdCQUFtQixVQUFXO0FBQUEsS0FHbEMsSUFIa0MsR0FPL0IsT0FQK0IsQ0FHbEMsSUFIa0M7QUFBQSxLQUlsQyxJQUprQyxHQU8vQixPQVArQixDQUlsQyxJQUprQztBQUFBLEtBS2xDLE9BTGtDLEdBTy9CLE9BUCtCLENBS2xDLE9BTGtDO0FBQUEsS0FNbEMsT0FOa0MsR0FPL0IsT0FQK0IsQ0FNbEMsT0FOa0M7OztBQVNuQyxLQUFNLE1BQU0sSUFBSSxLQUFKLENBQVUsT0FBVixDQUFaOztBQUVBLEtBQUksSUFBSixHQUFXLElBQVg7QUFDQSxLQUFJLElBQUosR0FBVyxJQUFYO0FBQ0EsS0FBSSxPQUFKLEdBQWMsT0FBZDs7QUFFQSxRQUFPLEdBQVA7QUFDQSxDQWhCRDs7QUFrQkEsSUFBTSxpQkFBaUIsU0FBakIsY0FBaUIsR0FBa0I7QUFBQSxLQUFqQixPQUFpQix1RUFBUCxFQUFPO0FBQUEsNEJBMkJwQyxPQTNCb0MsQ0FNdkMsV0FOdUM7QUFBQSxLQU12QyxXQU51Qyx3Q0FNekIsZ0JBQVE7O0FBRXJCLE1BQU0sV0FBVyxPQUFPLFFBQXhCO0FBQ0EsTUFBTSxPQUFPLEtBQUssWUFBTCxHQUFvQixjQUFwQixHQUFxQyxPQUFsRDs7QUFFQTtBQUNBLFNBQVUsU0FBUyxRQUFuQixVQUFnQyxTQUFTLElBQXpDLGNBQXNELElBQXREO0FBQ0EsRUFic0M7QUFBQSw2QkEyQnBDLE9BM0JvQyxDQWV2QyxjQWZ1QztBQUFBLEtBZXZDLGNBZnVDLHlDQWV0QixhQWZzQjtBQUFBLDBCQTJCcEMsT0EzQm9DLENBaUJ2QyxTQWpCdUM7QUFBQSxLQWlCdkMsU0FqQnVDLHNDQWlCM0I7QUFBQSxTQUFRLENBQUMsS0FBSyxL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Q0FBUDtBQUNBLEdBUE0sRUFPSixlQUFPO0FBQ1Q7QUFDQSxVQUFPLFNBQVMsaUJBQWlCO0FBQ2hDLFVBQVMsa0JBRHVCO0FBRWhDLGFBQVMsMkJBRnVCO0FBR2hDLFVBQVMsSUFIdUI7QUFJaEMsYUFBUztBQUp1QixJQUFqQixDQUFULENBQVA7QUFNQSxHQWZNLENBQVA7QUFpQkE7QUFFRCxDQXZERDs7QUF5REEsT0FBTyx5QkFBUCxHQUFtQyxjQUFuQyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uKCl7ZnVuY3Rpb24gcihlLG4sdCl7ZnVuY3Rpb24gbyhpLGYpe2lmKCFuW2ldKXtpZighZVtpXSl7dmFyIGM9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZTtpZighZiYmYylyZXR1cm4gYyhpLCEwKTtpZih1KXJldHVybiB1KGksITApO3ZhciBhPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIraStcIidcIik7dGhyb3cgYS5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGF9dmFyIHA9bltpXT17ZXhwb3J0czp7fX07ZVtpXVswXS5jYWxsKHAuZXhwb3J0cyxmdW5jdGlvbihyKXt2YXIgbj1lW2ldWzFdW3JdO3JldHVybiBvKG58fHIpfSxwLHAuZXhwb3J0cyxyLGUsbix0KX1yZXR1cm4gbltpXS5leHBvcnRzfWZvcih2YXIgdT1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlLGk9MDtpPHQubGVuZ3RoO2krKylvKHRbaV0pO3JldHVybiBvfXJldHVybiByfSkoKSIsIi8qKlxyXG4gKiBCYXNlZCBvbiBJYW1wb3J0J3MgSmF2YVNjcmlwdCBTREsuXHJcbiAqIC0gSWFtcG9ydCdzIEphdmFTY3JpcHQgU0RLIHNob3VsZCBiZSBpbXBvcnRlZCBiZWZvcmUgdGhpcyBwbHVnaW4uXHJcbiAqIC0gYElNUC5pbml0KCdpZCcpO2Agc2hvdWxkIGJlIGNhbGxlZCBiZWZvcmUgYG1ha2VQYXltZW50YCBnZXRzIGNhbGxlZC5cclxuICogLSBXZWJzaXRlOiBodHRwOi8vaWFtcG9ydC5rci9cclxuICogLSBHdWlkZTogaHR0cHM6Ly9kb2NzLmlhbXBvcnQua3IvXHJcbiAqL1xyXG5cclxuY29uc3QgUmVkaXJlY3Rpb25FcnJvciA9IG9wdGlvbnMgPT4ge1xyXG5cclxuXHRjb25zdCB7XHJcblx0XHRjb2RlLFxyXG5cdFx0dHlwZSxcclxuXHRcdHN1YmplY3QsXHJcblx0XHRtZXNzYWdlXHJcblx0fSA9IG9wdGlvbnM7XHJcblxyXG5cdGNvbnN0IGVyciA9IG5ldyBFcnJvcihtZXNzYWdlKTtcclxuXHJcblx0ZXJyLmNvZGUgPSBjb2RlO1xyXG5cdGVyci50eXBlID0gdHlwZTtcclxuXHRlcnIuc3ViamVjdCA9IHN1YmplY3Q7XHJcblxyXG5cdHJldHVybiBlcnI7XHJcbn07XHJcblxyXG5jb25zdCBpbXBsZW1lbnRhdGlvbiA9IChvcHRpb25zID0ge30pID0+IHtcclxuXHJcblx0Y29uc3Qge1xyXG5cdFx0Ly8gU2V0IHJlZGlyZWN0aW9uIFVSTCBmb3IgbW9iaWxlIHBheW1lbnRzIChJZiBpdCdzIG5lY2Vzc2FyeSkuXHJcblx0XHQvLyBEZWZhdWx0IHZhbHVlIGlzIHRoZSByb290IFVSTCBvZiB0aGUgd2Vic2l0ZS5cclxuXHRcdC8vIFJlZmVyZW5jZTogaHR0cHM6Ly9kb2NzLmlhbXBvcnQua3IvaW1wbGVtZW50YXRpb24vcGF5bWVudCNtb2JpbGUtd2ViLTFcclxuXHRcdHJlZGlyZWN0VVJMID0gZGF0YSA9PiB7XHJcblxyXG5cdFx0XHRjb25zdCBsb2NhdGlvbiA9IHdpbmRvdy5sb2NhdGlvbjtcclxuXHRcdFx0Y29uc3QgdHlwZSA9IGRhdGEuc3Vic2NyaXB0aW9uID8gJ3N1YnNjcmlwdGlvbicgOiAnb3JkZXInO1xyXG5cclxuXHRcdFx0Ly8gYD90eXBlYCBxdWVyeSBpcyByZXF1aXJlZC5cclxuXHRcdFx0cmV0dXJuIGAke2xvY2F0aW9uLnByb3RvY29sfS8vJHtsb2NhdGlvbi5ob3N0fT90eXBlPSR7dHlwZX1gO1xyXG5cdFx0fSxcclxuXHRcdC8vIEJpbGxpbmcga2V5IG5hbWUgcGxhY2Vob2xkZXIuXHJcblx0XHRiaWxsaW5nS2V5TmFtZSA9ICdCaWxsaW5nIEtleScsXHJcblx0XHQvLyBPcmRlciBuYW1lIGdldHRlci4gUmVjb21tZW5kZWQgbWF4IGxlbmd0aCAtPiAxNlxyXG5cdFx0b3JkZXJOYW1lID0gY2FydCA9PiAoY2FydC5pdGVtc1swXS5wcm9kdWN0Lm5hbWUgfHwgJycpLnNsaWNlKDAsIDE2KSxcclxuXHRcdC8vIEN1c3RvbWVyIG5hbWUgZ2V0dGVyLlxyXG5cdFx0YnV5ZXJOYW1lID0gY3VzdG9tZXIgPT4gY3VzdG9tZXIubmFtZS5mdWxsLFxyXG5cdFx0Ly8gQWRkcmVzcyBnZXR0ZXIuXHJcblx0XHRidXllckFkZHJlc3MgPSBhZGRyZXNzID0+IFtcclxuXHRcdFx0YWRkcmVzcy5hZGRyZXNzMSxcclxuXHRcdFx0YWRkcmVzcy5hZGRyZXNzMlxyXG5cdFx0XS5maWx0ZXIodiA9PiB2KS5qb2luKCcgJykudHJpbSgpLFxyXG5cdFx0Ly8gTW9iaWxlIHBheW1lbnQgcmVkaXJlY3Rpb24gaGFuZGxlci5cclxuXHRcdHJlZGlyZWN0aW9uQ2FsbGJhY2sgPSAoKSA9PiB7fVxyXG5cdH0gPSBvcHRpb25zO1xyXG5cclxuXHQvLyBIYW5kbGUgbW9iaWxlIHJlZGlyZWN0aW9ucyBhdXRvbWF0aWNhbGx5XHJcblx0aW1wbGVtZW50YXRpb24uaGFuZGxlUmVkaXJlY3QocmVkaXJlY3Rpb25DYWxsYmFjayk7XHJcblxyXG5cdHJldHVybiAoZGF0YSA9IHt9LCBjYWxsYmFjaykgPT4ge1xyXG5cclxuXHRcdGNvbnN0IHtcclxuXHRcdFx0cGF5bWVudE1ldGhvZCxcclxuXHRcdFx0Y2FydCxcclxuXHRcdFx0b3JkZXIsXHJcblx0XHRcdHN1YnNjcmlwdGlvbixcclxuXHRcdFx0Y3VzdG9tZXIsXHJcblx0XHR9ID0gZGF0YTtcclxuXHJcblx0XHRpZiAocGF5bWVudE1ldGhvZC5jYXJkRmllbGRzKSB7XHJcblx0XHRcdC8vIFNpbmNlIElhbXBvcnQgZG9lc24ndCBzdXBwb3J0IG1hbnVhbCBwYXltZW50IHdpdGggY2FyZCBpbmZvcm1hdGlvbixcclxuXHRcdFx0Ly8gZG8gbm90IGNhbGwgYElNUC5yZXF1ZXN0X3BheWAgbWV0aG9kLlxyXG5cdFx0XHRyZXR1cm4gY2FsbGJhY2sobnVsbCwge30pO1xyXG5cdFx0fVxyXG5cclxuXHRcdGNvbnN0IHN1YmplY3QgPSBzdWJzY3JpcHRpb24gfHwgb3JkZXI7XHJcblx0XHRjb25zdCBhZGRyZXNzID0gc3ViamVjdC5hZGRyZXNzLnNoaXBwaW5nO1xyXG5cdFx0Y29uc3QgY3VycmVuY3kgPSBzdWJqZWN0LmN1cnJlbmN5LnBheW1lbnQuY29kZTtcclxuXHJcblx0XHRjb25zdCB0YXhGcmVlID0gY2FydCA/IGltcGxlbWVudGF0aW9uLmNhbGN1bGF0ZVRheEZyZWUoY2FydCkgOiBudWxsO1xyXG5cclxuXHRcdC8vIERlZmF1bHQgcmVxdWVzdCBvcHRpb25zIGZvciBvcmRlcnMgYW5kIHN1YnNjcmlwdGlvbnNcclxuXHRcdGNvbnN0IHBhcmFtcyA9ICQuZXh0ZW5kKHtcclxuXHRcdFx0cGc6ICAgICAgICAgICAgIHBheW1lbnRNZXRob2QubWV0YS5wZyxcclxuXHRcdFx0cGF5X21ldGhvZDogICAgIHBheW1lbnRNZXRob2QubWV0YS5wYXlNZXRob2QsXHJcblx0XHRcdGN1cnJlbmN5OiAgICAgICBjdXJyZW5jeSxcclxuXHRcdFx0YnV5ZXJfZW1haWw6ICAgIGN1c3RvbWVyLmVtYWlsIHx8IG51bGwsXHJcblx0XHRcdGJ1eWVyX25hbWU6ICAgICBidXllck5hbWUoY3VzdG9tZXIpLFxyXG5cdFx0XHRidXllcl90ZWw6ICAgICAgY3VzdG9tZXIubW9iaWxlIHx8IGN1c3RvbWVyLnBob25lLCAvLyBSZXF1aXJlZCBieSBJYW1wb3J0XHJcblx0XHRcdGJ1eWVyX2FkZHI6ICAgICBidXllckFkZHJlc3MoYWRkcmVzcyksXHJcblx0XHRcdGJ1eWVyX3Bvc3Rjb2RlOiBhZGRyZXNzLnBvc3Rjb2RlLFxyXG5cdFx0XHRtX3JlZGlyZWN0X3VybDogcmVkaXJlY3RVUkwoZGF0YSkgLy8gU2V0IHJlZGlyZWN0IFVSTCBpZiBpcyBuZWVkZWQuLi5cclxuXHRcdH0sIHN1YnNjcmlwdGlvbiA/IHtcclxuXHRcdFx0Ly8gU3Vic2NyaXB0aW9uIGNhc2UsIElzc3VlIGEgYmlsbGluZyBrZXkgZm9yIHN1YnNjcmlwdGlvbnMuXHJcblx0XHRcdC8vIFJlZmVyZW5jZTogaHR0cHM6Ly9naXRodWIuY29tL2lhbXBvcnQvaWFtcG9ydC1tYW51YWwvdHJlZS9tYXN0ZXIvJUVCJUI5JTg0JUVDJTlEJUI4JUVDJUE2JTlEJUVBJUIyJUIwJUVDJUEwJTlDL2V4YW1wbGVcclxuXHRcdFx0bWVyY2hhbnRfdWlkOiBzdWJzY3JpcHRpb24uX2lkLCAvLyBTZXQgYG1lcmNoYW50X3VpZGAgYXMgYSBzdWJzY3JpcHRpb24ncyBpZFxyXG5cdFx0XHQvLyBCaWxsaW5nIGtleSB3aWxsIGJlIGlzc3VlZC4uXHJcblx0XHRcdC8vIEZvciBhIHJlZ2lzdGVyZWQgY3VzdG9tZXI6IGN1c3RvbWVyLl9pZFxyXG5cdFx0XHQvLyBGb3IgYSBub24tcmVnaXN0ZXJlZCBjdXN0b21lcjogc3Vic2NyaXB0aW9uLl9pZFxyXG5cdFx0XHRjdXN0b21lcl91aWQ6IHN1YnNjcmlwdGlvbi5jdXN0b21lci5faWQgfHwgc3Vic2NyaXB0aW9uLl9pZCxcclxuXHRcdFx0bmFtZTogICAgICAgICBiaWxsaW5nS2V5TmFtZSwgICAvLyBQbGFjZWhvbGRlciBuYW1lXHJcblx0XHRcdGFtb3VudDogICAgICAgMCxcclxuXHRcdH0gOiAkLmV4dGVuZCh7XHJcblx0XHRcdC8vIFJlZ3VsYXIgb3JkZXIgY2FzZS5cclxuXHRcdFx0bWVyY2hhbnRfdWlkOiBvcmRlci5faWQsXHJcblx0XHRcdG5hbWU6ICAgICAgICAgb3JkZXJOYW1lKGNhcnQpLFxyXG5cdFx0XHQvLyBIYW5kbGUgcmljaCBkYXRhIGNhc2VzLlxyXG5cdFx0XHRhbW91bnQ6ICAgICAgIHR5cGVvZiBvcmRlci50b3RhbC5hbW91bnQucmF3ID09PSAnbnVtYmVyJyA/XHJcblx0XHRcdFx0XHRcdFx0b3JkZXIudG90YWwuYW1vdW50LnJhdyA6XHJcblx0XHRcdFx0XHRcdFx0b3JkZXIudG90YWwuYW1vdW50LFxyXG5cdFx0fSwgdGF4RnJlZSA/IHtcclxuXHRcdFx0Ly8gYHRheF9mcmVlYCBwYXJhbSBpcyBvbmx5IHN1cHBvcnRlZCBmb3IgcmVndWxhciBvcmRlcnMgZm9yIG5vdy5cclxuXHRcdFx0dGF4X2ZyZWU6IHRheEZyZWVcclxuXHRcdH0gOiB7fSkpO1xyXG5cclxuXHRcdHJldHVybiBJTVAucmVxdWVzdF9wYXkocGFyYW1zLCByZXMgPT4ge1xyXG5cdFx0XHRyZXR1cm4gY2FsbGJhY2socmVzLnN1Y2Nlc3MgPyBudWxsIDogcmVzLCByZXMpO1xyXG5cdFx0fSk7XHJcblxyXG5cdH07XHJcblxyXG59O1xyXG5cclxuaW1wbGVtZW50YXRpb24uY2FsY3VsYXRlVGF4RnJlZSA9IGNhcnQgPT4ge1xyXG5cclxuXHRjb25zdCBpc1plcm9UYXhlZCA9IGl0ZW0gPT4gaXRlbS50YXhlZC5jb252ZXJ0ZWRSYXcgPT09IDA7XHJcblxyXG5cdC8vIEhhbmRsZSBgdGF4X2ZyZWVgIHBhcmFtZXRlciBvZiBJYW1wb3J0IGZvciB0YXggZXhlbXB0ZWQgJiB6ZXJvLXJhdGVkIHByb2R1Y3RzLlxyXG5cdC8vIFJlZmVyZW5jZTogaHR0cHM6Ly9kb2NzLmlhbXBvcnQua3IvdGVjaC92YXRcclxuXHRjb25zdCBpdGVtc1dpdGhaZXJvVGF4ID0gW10uY29uY2F0KFxyXG5cdFx0Ly8gWmVybyB0YXhlZCBpdGVtc1xyXG5cdFx0Y2FydC5pdGVtc1xyXG5cdFx0XHQucmVkdWNlKChpdGVtcywgaXRlbSkgPT4gaXRlbXMuY29uY2F0KGl0ZW0sIGl0ZW0uYnVuZGxlSXRlbXMgfHwgW10pLCBbXSlcclxuXHRcdFx0LmZpbHRlcihpc1plcm9UYXhlZClcclxuXHRcdFx0Lm1hcChpdGVtID0+IGl0ZW0ucHJpY2Uud2l0aFRheC5jb252ZXJ0ZWRSYXcpLFxyXG5cdFx0Ly8gWmVybyB0YXhlZCBzaGlwbWVudFxyXG5cdFx0KGNhcnQuc2hpcG1lbnRzIHx8IFtdKVxyXG5cdFx0XHQuZmlsdGVyKGlzWmVyb1RheGVkKVxyXG5cdFx0XHQubWFwKHNoaXBtZW50ID0+IHNoaXBtZW50LmZlZS53aXRoVGF4LmNvbnZlcnRlZFJhdylcclxuXHQpLmZpbHRlcih2ID0+IHYgIT09IDApOyAvLyBKdXN0IGluIGNhc2Ugd2hlcmUgYW4gYWN0dWFsIGl0ZW0vc2hpcG1lbnQncyBwcmljZSBpcyAwXHJcblxyXG5cdGlmIChpdGVtc1dpdGhaZXJvVGF4Lmxlbmd0aCA9PT0gMCkge1xyXG5cdFx0Ly8gVGhlcmUgYXJlIG5vIHplcm8gdGF4ZWQgaXRlbXMgYW5kIHNoaXBtZW50c1xyXG5cdFx0cmV0dXJuIG51bGw7XHJcblx0fVxyXG5cclxuXHQvLyBCdWlsZCBhIHN1bSBwcmljZSBvZiB0YXggZnJlZSBpdGVtcyBhbmQgc2hpcG1lbnRzLlxyXG5cdC8vIEl0IGlzIGltcG9ydGFudCB0aGF0IHdlIHVzZSB0aGUgcGF5bWVudCBjdXJyZW5jeSdzIHByZWNpc2lvbiB0byBjYWxjdWxhdGUgc3VtLlxyXG5cdC8vIFJlZmVyZW5jZTogaHR0cHM6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMTQ1ODYzMy9ob3ctdG8tZGVhbC13aXRoLWZsb2F0aW5nLXBvaW50LW51bWJlci1wcmVjaXNpb24taW4tamF2YXNjcmlwdFxyXG5cdGNvbnN0IHByZWNpc2lvbiA9IGNhcnQuY3VycmVuY3kucGF5bWVudC5wcmVjaXNpb247XHJcblxyXG5cdGxldCBzdW0gPSBpdGVtc1dpdGhaZXJvVGF4LnJlZHVjZSgoc3VtLCB2KSA9PiBzdW0gKyB2LCAwKTtcclxuXHJcblx0aWYgKHByZWNpc2lvbiA+IDApIHtcclxuXHRcdHN1bSA9IHBhcnNlRmxvYXQocGFyc2VGbG9hdChzdW0pLnRvUHJlY2lzaW9uKHByZWNpc2lvbikpO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHN1bTtcclxuXHJcbn07XHJcblxyXG5pbXBsZW1lbnRhdGlvbi5oYW5kbGVSZWRpcmVjdCA9IGNhbGxiYWNrID0+IHtcclxuXHJcblx0Y29uc3QgVGh1bmRlciA9IHdpbmRvdy5UaHVuZGVyO1xyXG5cdGNvbnN0IHF1ZXJ5ID0gVGh1bmRlci51dGlsLnVybFF1ZXJ5KCk7XHJcblxyXG5cdGNvbnN0IHR5cGVzID0ge1xyXG5cdFx0b3JkZXI6ICAgICAgICB0cnVlLFxyXG5cdFx0c3Vic2NyaXB0aW9uOiB0cnVlLFxyXG5cdH07XHJcblxyXG5cdGlmICh0eXBlc1txdWVyeS50eXBlXSAmJiBxdWVyeS5tZXJjaGFudF91aWQpIHtcclxuXHJcblx0XHRjb25zdCB7XHJcblx0XHRcdGltcF9zdWNjZXNzOiAgc3VjY2VzcyxcclxuXHRcdFx0dHlwZTogICAgICAgICB0eXBlLFxyXG5cdFx0XHRtZXJjaGFudF91aWQ6IHN1YmplY3RcclxuXHRcdH0gPSBxdWVyeTtcclxuXHJcblx0XHQvLyBQYXltZW50IGZhaWx1cmUgY2FzZS4uLlxyXG5cdFx0aWYgKHN1Y2Nlc3MgIT09ICd0cnVlJykge1xyXG5cclxuXHRcdFx0cmV0dXJuIGNhbGxiYWNrKFJlZGlyZWN0aW9uRXJyb3Ioe1xyXG5cdFx0XHRcdGNvZGU6ICAgICdpYW1wb3J0LXBheW1lbnQnLFxyXG5cdFx0XHRcdG1lc3NhZ2U6ICdGYWlsZWQgdG8gbWFrZSBhIHBheW1lbnQuJyxcclxuXHRcdFx0XHR0eXBlOiAgICB0eXBlLFxyXG5cdFx0XHRcdHN1YmplY3Q6IHN1YmplY3RcclxuXHRcdFx0fSkpO1xyXG5cdFx0fVxyXG5cclxuXHRcdC8vIFBheW1lbnQgc3VjY2VzcyBjYXNlLi4uXHJcblx0XHRpZiAodHlwZSA9PT0gJ29yZGVyJykge1xyXG5cdFx0XHQvLyBSZWd1bGFyIG9yZGVyIGNhc2VcclxuXHRcdFx0cmV0dXJuIGNhbGxiYWNrKG51bGwsIHsgdHlwZSwgc3ViamVjdCB9KTtcclxuXHRcdH1cclxuXHJcblx0XHQvLyBTdWJzY3JpcHRpb24gY2FzZSwgd2Ugc2hvdWxkIHBvc3Qgc2NoZWR1bGVzIHRvIElhbXBvcnQgdmlhIENsYXlmdWwncyBBUElcclxuXHRcdHJldHVybiBUaHVuZGVyLnJlcXVlc3Qoe1xyXG5cdFx0XHRtZXRob2Q6ICdQT1NUJyxcclxuXHRcdFx0dXJsOiAgICBgL3YxL21lL3N1YnNjcmlwdGlvbnMvJHtzdWJqZWN0fS9zY2hlZHVsZWRgLFxyXG5cdFx0XHRkYXRhOiAgIHt9LFxyXG5cdFx0fSkudGhlbigoKSA9PiB7XHJcblx0XHRcdC8vIFNjaGVkdWxpbmcgc3VjY2VlZGVkLi4uXHJcblx0XHRcdHJldHVybiBjYWxsYmFjayhudWxsLCB7IHR5cGUsIHN1YmplY3QgfSk7XHJcblx0XHR9LCBlcnIgPT4ge1xyXG5cdFx0XHQvLyBTY2hlZHVsaW5nIGZhaWxlZC4uLlxyXG5cdFx0XHRyZXR1cm4gY2FsbGJhY2soUmVkaXJlY3Rpb25FcnJvcih7XHJcblx0XHRcdFx0Y29kZTogICAgJ2NsYXlmdWwtc2NoZWR1bGUnLFxyXG5cdFx0XHRcdG1lc3NhZ2U6ICdGYWlsZWQgdG8gcG9zdCBzY2hlZHVsZXMuJyxcclxuXHRcdFx0XHR0eXBlOiAgICB0eXBlLFxyXG5cdFx0XHRcdHN1YmplY3Q6IHN1YmplY3RcclxuXHRcdFx0fSkpO1xyXG5cdFx0fSk7XHJcblxyXG5cdH1cclxuXHJcbn07XHJcblxyXG53aW5kb3cuVGh1bmRlck1ha2VQYXltZW50SWFtcG9ydCA9IGltcGxlbWVudGF0aW9uOyJdfQ==
