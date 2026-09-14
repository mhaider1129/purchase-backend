class RfidPrinterAdapter {
  get configured() { return false; }
  async printAndEncode() { const err = new Error('RFID ENCODING NOT CONFIGURED');err.statusCode=501;err.code='RFID_ENCODING_NOT_CONFIGURED';throw err; }
}

class AssetLabelService {
  constructor(repository, printer = new RfidPrinterAdapter()) { this.repository=repository;this.printer=printer; }
  qrPayload(asset) { return `WICI-ASSET:${asset.asset_number}`; }
  async printAndEncode(asset, epc, ctx) {
    if (!this.printer.configured) return this.printer.printAndEncode();
    const verification=await this.printer.printAndEncode({assetNumber:asset.asset_number,epc,qrPayload:this.qrPayload(asset)});
    if (!verification?.verified || verification.epc!==epc) { const err=new Error('RFID encoding verification failed');err.statusCode=502;throw err; }
    // The association is deliberately activated only after hardware read-back.
    return this.repository.query("UPDATE asset_tags SET tag_status='ACTIVE',installed_at=now(),installed_by=$1 WHERE asset_id=$2 AND institute_id=$3 AND epc=$4 AND tag_status='PENDING_ENCODING' RETURNING *",[ctx.userId,asset.id,ctx.instituteId,epc]);
  }
}
module.exports={AssetLabelService,RfidPrinterAdapter};