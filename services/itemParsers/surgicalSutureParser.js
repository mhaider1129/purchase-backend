const { capture, result } = require('./parserUtils');
const VERSION='surgical-suture.v1';
function parse(source){return result('surgical_suture',VERSION,source,{
 absorbability:{extract:t=>/non[- ]?absorbable/.test(t)?{value:'non_absorbable',fragment:t.match(/non[- ]?absorbable/)[0]}:/\babsorbable\b/.test(t)?{value:'absorbable',fragment:'absorbable'}:null,rule:'absorbability.keyword.v1',confidence:.98},
 material:{extract:t=>capture(t,/\b(polyglactin|polydioxanone|polypropylene|nylon|silk|polyester)\b/),rule:'suture.material.v1'},construction:{extract:t=>capture(t,/\b(monofilament|braided|multifilament)\b/),rule:'suture.construction.v1'},
 coating:{extract:t=>capture(t,/\b(coated|uncoated|triclosan coated)\b/),rule:'suture.coating.v1'},color:{extract:t=>capture(t,/\b(violet|blue|black|undyed|clear)\b/),rule:'color.v1'},
 suture_size:{extract:t=>capture(t,/\b(\d(?:-0|\/0)|\d)\b(?=.*(?:suture|needle))/),rule:'usp-size.v1'},strand_length:{extract:t=>capture(t,/\b(\d+(?:\.\d+)?)\s*(cm|mm)\b/,m=>m),rule:'length.metric.v1'},
 needle_presence:{extract:t=>/\bneedleless\b/.test(t)?{value:false,fragment:'needleless'}:/\bneedle\b/.test(t)?{value:true,fragment:'needle'}:null,rule:'needle.presence.v1'},needle_count:{extract:t=>capture(t,/\b(\d+)\s*needles?\b/,Number),rule:'needle.count.v1'},
 needle_type:{extract:t=>capture(t,/\b(reverse cutting|cutting|taper(?: point)?|blunt)\b/),rule:'needle.type.v1'},needle_point:{extract:t=>capture(t,/\b(taper point|cutting point|blunt point)\b/),rule:'needle.point.v1'},
 needle_curvature:{extract:t=>capture(t,/\b(1\/2|3\/8|5\/8|1\/4)\s*(?:circle|c)?\b/),rule:'needle.curvature.v1'},needle_length:{extract:t=>capture(t,/\b(\d+(?:\.\d+)?)\s*mm\s*needle\b/,Number),rule:'needle.length.v1'},
 sterility:{extract:t=>/\bnon[- ]?sterile\b/.test(t)?{value:false,fragment:'non-sterile'}:/\bsterile\b/.test(t)?{value:true,fragment:'sterile'}:null,rule:'sterility.v1'},pack_configuration:{extract:t=>capture(t,/\b(?:pack|box)\s*(?:of|x)?\s*(\d+)\b/,Number),rule:'pack.v1'},
 manufacturer:{extract:t=>capture(t,/\b(?:mfr|manufacturer)[: ]+([a-z0-9 .&-]+)/),rule:'manufacturer.label.v1'},catalog_number:{extract:t=>capture(t,/\b(?:ref|catalog|cat)\s*[#:]?\s*([a-z0-9-]+)\b/),rule:'catalog.label.v1'}
});}
module.exports={parse,PARSER_VERSION:VERSION};