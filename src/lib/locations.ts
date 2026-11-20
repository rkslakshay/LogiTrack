// Built-in gazetteer of Indian logistics locations. It replaces a paid geocoding
// API: forms let the user pick a known place (or click the map / type coordinates).

export interface Place {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
}

const p = (id: string, name: string, city: string, lat: number, lng: number): Place => ({ id, name, city, lat, lng });

export const PLACES: Place[] = [
  // Delhi NCR
  p("del-okhla", "Okhla Industrial Area Phase II", "New Delhi", 28.5355, 77.2732),
  p("del-cp", "Connaught Place", "New Delhi", 28.6315, 77.2167),
  p("del-dwarka", "Dwarka Sector 21", "New Delhi", 28.5523, 77.0583),
  p("del-azadpur", "Azadpur Mandi", "New Delhi", 28.7089, 77.1787),
  p("ggn-cyber", "Cyber City, DLF Phase 2", "Gurugram", 28.4949, 77.0895),
  p("ggn-manesar", "IMT Manesar", "Gurugram", 28.3606, 76.9366),
  p("noi-62", "Sector 62", "Noida", 28.6208, 77.3639),
  p("noi-gn", "Knowledge Park III", "Greater Noida", 28.4744, 77.4902),
  p("fbd-nit", "NIT Industrial Area", "Faridabad", 28.3915, 77.3016),
  p("gzb-sahib", "Sahibabad Industrial Area", "Ghaziabad", 28.6692, 77.3538),
  // Mumbai region
  p("mum-andheri", "MIDC Andheri East", "Mumbai", 19.1176, 72.8721),
  p("mum-bkc", "Bandra Kurla Complex", "Mumbai", 19.0669, 72.8697),
  p("mum-powai", "Hiranandani Gardens, Powai", "Mumbai", 19.1187, 72.9115),
  p("mum-lowerparel", "Lower Parel", "Mumbai", 18.9984, 72.8302),
  p("mum-vashi", "APMC Market, Vashi", "Navi Mumbai", 19.0771, 73.0087),
  p("mum-jnpt", "JNPT Port, Nhava Sheva", "Navi Mumbai", 18.9499, 72.9512),
  p("mum-thane", "Wagle Industrial Estate", "Thane", 19.1973, 72.9517),
  p("mum-bhiwandi", "Bhiwandi Logistics Park", "Bhiwandi", 19.2813, 73.0483),
  // Pune
  p("pun-hinjewadi", "Rajiv Gandhi Infotech Park, Hinjewadi", "Pune", 18.5913, 73.7389),
  p("pun-chakan", "Chakan MIDC", "Pune", 18.7606, 73.8636),
  p("pun-kothrud", "Kothrud", "Pune", 18.5074, 73.8077),
  p("pun-hadapsar", "Magarpatta City, Hadapsar", "Pune", 18.5158, 73.9272),
  p("pun-pimpri", "Pimpri MIDC", "Pimpri-Chinchwad", 18.6298, 73.7997),
  // Bengaluru
  p("blr-whitefield", "ITPL Whitefield", "Bengaluru", 12.9857, 77.7369),
  p("blr-ecity", "Electronic City Phase 1", "Bengaluru", 12.8452, 77.6602),
  p("blr-peenya", "Peenya Industrial Area", "Bengaluru", 13.0285, 77.5197),
  p("blr-koramangala", "Koramangala 5th Block", "Bengaluru", 12.9352, 77.6245),
  p("blr-yeshwanthpur", "Yeshwanthpur APMC Yard", "Bengaluru", 13.0234, 77.5501),
  p("blr-hosur", "SIPCOT Industrial Complex", "Hosur", 12.7409, 77.8253),
  // Hyderabad
  p("hyd-hitec", "HITEC City", "Hyderabad", 17.4435, 78.3772),
  p("hyd-secbad", "Secunderabad Station Road", "Hyderabad", 17.4344, 78.5013),
  p("hyd-shamshabad", "Shamshabad Cargo Terminal", "Hyderabad", 17.2403, 78.4294),
  p("hyd-patancheru", "Patancheru Industrial Area", "Hyderabad", 17.5326, 78.2644),
  // Chennai
  p("maa-guindy", "Guindy Industrial Estate", "Chennai", 13.0067, 80.2206),
  p("maa-ambattur", "Ambattur Industrial Estate", "Chennai", 13.0982, 80.1614),
  p("maa-sriperumbudur", "Sriperumbudur SIPCOT", "Chennai", 12.9675, 79.9419),
  p("maa-port", "Chennai Port", "Chennai", 13.0827, 80.2919),
  // Other metros
  p("amd-naroda", "Naroda GIDC", "Ahmedabad", 23.0707, 72.6576),
  p("amd-sg", "SG Highway, Bodakdev", "Ahmedabad", 23.0396, 72.5116),
  p("jai-sitapura", "Sitapura Industrial Area", "Jaipur", 26.7781, 75.8372),
  p("jai-mi", "MI Road", "Jaipur", 26.9157, 75.8103),
  p("ccu-saltlake", "Salt Lake Sector V", "Kolkata", 22.5726, 88.4339),
  p("ccu-howrah", "Howrah Goods Terminal", "Howrah", 22.5839, 88.3426),
  p("lko-gomti", "Gomti Nagar", "Lucknow", 26.8496, 81.0072),
  p("ngp-butibori", "Butibori MIDC", "Nagpur", 20.9349, 78.9426),
  p("sur-sachin", "Sachin GIDC", "Surat", 21.0877, 72.8811),
  p("nsk-ambad", "Ambad MIDC", "Nashik", 19.9506, 73.7384),
  p("cjb-peelamedu", "Peelamedu Industrial Estate", "Coimbatore", 11.0261, 77.0028),
];

export const placeLabel = (place: Place) => `${place.name}, ${place.city}`;

export const placeById = (id: string) => PLACES.find((x) => x.id === id);

/** Centre of India, used as the default map view. */
export const INDIA_CENTER: [number, number] = [21.5, 78.5];
