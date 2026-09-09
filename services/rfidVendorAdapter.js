/** Vendor adapters must return this normalized shape; the core never consumes SDK payloads. */
class RfidVendorAdapter { normalize(_vendorPayload) { throw new Error('Adapter must implement normalize()'); } }
module.exports=RfidVendorAdapter;