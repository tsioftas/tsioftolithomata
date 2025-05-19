var thisScript = document.currentScript;
var doc = document;

samples = [
    // {
    //     "image_path": "/images/hypolophodon_sylvestris/sample1",
    //     "images": [
    //         "hypolophodon_sylvestris1_1.jpg",
    //         "hypolophodon_sylvestris1_2.jpg"
    //     ],
    //     "species": "†Hypolophodon sylvestris",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    // },
    // {
    //     "image_path": "/images/hypolophodon_sylvestris/sample2",
    //     "images": [
    //         "hypolophodon_sylvestris2_1.jpg",
    //         "hypolophodon_sylvestris2_2.jpg",
    //         "hypolophodon_sylvestris2_3.jpg"
    //     ],
    //     "species": "†Hypolophodon sylvestris",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    // },
    // {
    //     "image_path": "/images/hypolophodon_sylvestris/sample3",
    //     "images": [
    //         "hypolophodon_sylvestris3_1.jpg",
    //         "hypolophodon_sylvestris3_2.jpg",
    //         "hypolophodon_sylvestris3_3.jpg",
    //         "hypolophodon_sylvestris3_4.jpg"
    //     ],
    //     "species": "†Hypolophodon sylvestris",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    // },
    // {
    //     "image_path": "/images/hypolophodon_sylvestris/sample4",
    //     "images": [
    //         "hypolophodon_sylvestris4_1.jpg",
    //         "hypolophodon_sylvestris4_2.jpg"
    //     ],
    //     "species": "†Hypolophodon sylvestris",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    // },
    // {
    //     "image_path": "/images/hypolophodon_sylvestris/sample5",
    //     "images": [
    //         "hypolophodon_sylvestris5_1.jpg",
    //         "hypolophodon_sylvestris5_2.jpg",
    //         "hypolophodon_sylvestris5_3.jpg",
    //         "hypolophodon_sylvestris5_4.jpg"
    //     ],
    //     "species": "†Hypolophodon sylvestris",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    // },
    // {
    //     "image_path": "/images/hypolophodon_sylvestris/sample6",
    //     "images": [
    //         "hypolophodon_sylvestris6_1.jpg",
    //         "hypolophodon_sylvestris6_2.jpg",
    //         "hypolophodon_sylvestris6_3.jpg"
    //     ],
    //     "species": "†Hypolophodon sylvestris",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    // },
    // {
    //     "image_path": "/images/hypolophodon_sylvestris/sample7",
    //     "images": [
    //         "hypolophodon_sylvestris7_1.jpg",
    //         "hypolophodon_sylvestris7_2.jpg",
    //         "hypolophodon_sylvestris7_3.jpg",
    //         "hypolophodon_sylvestris7_4.jpg",
    //         "hypolophodon_sylvestris7_5.jpg"
    //     ],
    //     "species": "†Hypolophodon sylvestris",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    // },
    // {
    //     "image_path": "/images/hypolophodon_sylvestris/sample8",
    //     "images": [
    //         "hypolophodon_sylvestris8_1.jpg",
    //         "hypolophodon_sylvestris8_2.jpg",
    //         "hypolophodon_sylvestris8_3.jpg"
    //     ],
    //     "species": "†Hypolophodon sylvestris",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    // },
    // {
    //     "image_path": "/images/lepisosteus_suessionensis/sample1",
    //     "images": [
    //         "lepisosteus_suessionensis1_1.jpg",
    //         "lepisosteus_suessionensis1_2.jpg",
    //         "lepisosteus_suessionensis1_3.jpg"
    //     ],
    //     "species": "†Lepisosteus suessionensis",
    //     "link_to_species": "/tree/animalia/chordata/osteichthyes/actinopterygii/lepisosteidae/lepisosteus/lepisosteus_suessionensis/lepisosteus_suessionensis.html",
    // },
    // {
    //     "image_path": "/images/theodoxus_pisiformis/sample1",
    //     "images": [
    //         "theodoxus_pisiformis1_1.jpg",
    //         "theodoxus_pisiformis1_2.jpg",
    //         "theodoxus_pisiformis1_3.jpg"
    //     ],
    //     "species": "†Theodoxus pisiformis",
    //     "link_to_species": "/tree/animalia/mollusca/gastropoda/neritimorpha/neritidae/theodoxus/theodoxus_pisiformis/theodoxus_pisiformis.html",
    // },
    // {
    //     "image_path": "/images/theodoxus_pisiformis/sample2",
    //     "images": [
    //         "theodoxus_pisiformis2_1.jpg",
    //         "theodoxus_pisiformis2_2.jpg",
    //         "theodoxus_pisiformis2_3.jpg",
    //         "theodoxus_pisiformis2_4.jpg"
    //     ],
    //     "species": "†Theodoxus pisiformis",
    //     "link_to_species": "/tree/animalia/mollusca/gastropoda/neritimorpha/neritidae/theodoxus/theodoxus_pisiformis/theodoxus_pisiformis.html",
    // },
    // {
    //     "image_path": "/images/theodoxus_pisiformis/sample3",
    //     "images": [
    //         "theodoxus_pisiformis3_1.jpg",
    //         "theodoxus_pisiformis3_2.jpg",
    //         "theodoxus_pisiformis3_3.jpg",
    //         "theodoxus_pisiformis3_4.jpg"
    //     ],
    //     "species": "†Theodoxus pisiformis",
    //     "link_to_species": "/tree/animalia/mollusca/gastropoda/neritimorpha/neritidae/theodoxus/theodoxus_pisiformis/theodoxus_pisiformis.html",
    // },
    // {
    //     "image_path": "/images/lepisosteus_suessionensis/sample2",
    //     "images": [
    //         "lepisosteus_suessionensis2_1.jpg",
    //         "lepisosteus_suessionensis2_2.jpg",
    //         "lepisosteus_suessionensis2_3.jpg"
    //     ],
    //     "species": "†Lepisosteus suessionensis",
    //     "link_to_species": "/tree/animalia/chordata/osteichthyes/actinopterygii/lepisosteidae/lepisosteus/lepisosteus_suessionensis/lepisosteus_suessionensis.html",
    // },
    // {
    //     "image_path": "/images/lepisosteus_suessionensis/sample3",
    //     "images": [
    //         "lepisosteus_suessionensis3_1.jpg",
    //         "lepisosteus_suessionensis3_2.jpg",
    //         "lepisosteus_suessionensis3_3.jpg",
    //         "lepisosteus_suessionensis3_4.jpg"
    //     ],
    //     "species": "†Lepisosteus suessionensis",
    //     "link_to_species": "/tree/animalia/chordata/osteichthyes/actinopterygii/lepisosteidae/lepisosteus/lepisosteus_suessionensis/lepisosteus_suessionensis.html",
    // },
    // {
    //     "image_path": "/images/hypolophodon_sylvestris/sample9",
    //     "images": [
    //         "hypolophodon_sylvestris9_1.jpg",
    //         "hypolophodon_sylvestris9_2.jpg",
    //         "hypolophodon_sylvestris9_3.jpg",
    //         "hypolophodon_sylvestris9_4.jpg",
    //         "hypolophodon_sylvestris9_5.jpg"
    //     ],
    //     "species": "†Hypolophodon sylvestris",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    // },
    // {
    //     "image_path": "/images/theodoxus_pisiformis/sample4",
    //     "images": [
    //         "theodoxus_pisiformis4_1.jpg",
    //         "theodoxus_pisiformis4_2.jpg",
    //         "theodoxus_pisiformis4_3.jpg",
    //         "theodoxus_pisiformis4_4.jpg",
    //         "theodoxus_pisiformis4_5.jpg"
    //     ],
    //     "species": "†Theodoxus pisiformis",
    //     "link_to_species": "/tree/animalia/mollusca/gastropoda/neritimorpha/neritidae/theodoxus/theodoxus_pisiformis/theodoxus_pisiformis.html",
    // },
    // {
    //     "image_path": "/images/striatolamia_macrota/sample1",
    //     "images": [
    //         "striatolamia_macrota1_1.jpg",
    //         "striatolamia_macrota1_2.jpg",
    //         "striatolamia_macrota1_3.jpg",
    //         "striatolamia_macrota1_4.jpg"
    //     ],
    //     "species": "†Striatolamia macrota",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/odontaspididae/striatolamia/striatolamia_macrota/striatolamia_macrota.html",
    // },
    // {
    //     "image_path": "/images/striatolamia_macrota/sample2",
    //     "images": [
    //         "striatolamia_macrota2_1.jpg",
    //         "striatolamia_macrota2_2.jpg",
    //         "striatolamia_macrota2_3.jpg"
    //     ],
    //     "species": "†Striatolamia macrota",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/odontaspididae/striatolamia/striatolamia_macrota/striatolamia_macrota.html",
    // },
    // {
    //     "image_path": "/images/striatolamia_macrota/sample3",
    //     "images": [
    //         "striatolamia_macrota3_1.jpg",
    //         "striatolamia_macrota3_2.jpg",
    //         "striatolamia_macrota3_3.jpg",
    //         "striatolamia_macrota3_4.jpg",
    //         "striatolamia_macrota3_5.jpg"
    //     ],
    //     "species": "†Striatolamia macrota",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/odontaspididae/striatolamia/striatolamia_macrota/striatolamia_macrota.html",
    // },
    // {
    //     "image_path": "/images/sylvestrilamia_teretidens/sample1",
    //     "images": [
    //         "sylvestrilamia_teretidens1_1.jpg",
    //         "sylvestrilamia_teretidens1_2.jpg",
    //         "sylvestrilamia_teretidens1_3.jpg",
    //         "sylvestrilamia_teretidens1_4.jpg",
    //         "sylvestrilamia_teretidens1_5.jpg",
    //     ],
    //     "species": "†Sylvestrilamia teretidens",
    //     "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/odontaspididae/sylvestrilamia/sylvestrilamia_teretidens/sylvestrilamia_teretidens.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample7",
    //     "images": [
    //         "U7_1.jpg",
    //         "U7_2.jpg",
    //         "U7_3.jpg",
    //         "U7_4.jpg",
    //     ],
    //     "species": "?actinopterygii",
    //     "link_to_species": "/tree/animalia/chordata/osteichthyes/actinopterygii/actinopterygii.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample3",
    //     "images": [
    //         "U2_1.jpg",
    //     ],
    //     "species": "?plantae",
    //     "link_to_species": "/tree/plantae/plantae.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample1",
    //     "images": [
    //         "U1_1.jpg",
    //     ],
    //     "species": "?plantae",
    //     "link_to_species": "/tree/plantae/plantae.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample4",
    //     "images": [
    //         "U4_1.jpg",
    //     ],
    //     "species": "?chordata",
    //     "link_to_species": "/tree/animalia/chordata/chordata.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample5",
    //     "images": [
    //         "U5_1.jpg",
    //     ],
    //     "species": "?plantae",
    //     "link_to_species": "/tree/plantae/plantae.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample6",
    //     "images": [
    //         "U6_1.jpg",
    //     ],
    //     "species": "?autobranchia",
    //     "link_to_species": "/tree/animalia/mollusca/bivalvia/autobranchia/autobranchia.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample8",
    //     "images": [
    //         "U8_1.jpg",
    //     ],
    //     "species": "?chordata",
    //     "link_to_species": "/tree/animalia/chordata/chordata.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample9",
    //     "images": [
    //         "U9_1.jpg",
    //     ],
    //     "species": "?plantae",
    //     "link_to_species": "/tree/plantae/plantae.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample9",
    //     "images": [
    //         "U9_1.jpg",
    //     ],
    //     "species": "?chordata",
    //     "link_to_species": "/tree/animalia/chordata/chordata.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample10",
    //     "images": [
    //         "U10_1.jpg",
    //     ],
    //     "species": "?chordata",
    //     "link_to_species": "/tree/animalia/chordata/chordata.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample11",
    //     "images": [
    //         "U11_1.jpg",
    //     ],
    //     "species": "?chordata",
    //     "link_to_species": "/tree/animalia/chordata/chordata.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample12",
    //     "images": [
    //         "U12_1.jpg",
    //     ],
    //     "species": "?chordata",
    //     "link_to_species": "/tree/animalia/chordata/chordata.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample13",
    //     "images": [
    //         "U13_1.jpg",
    //     ],
    //     "species": "?actinopterygii",
    //     "link_to_species": "/tree/animalia/chordata/osteichthyes/actinopterygii/actinopterygii.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample14",
    //     "images": [
    //         "U14_1.jpg",
    //     ],
    //     "species": "?plantae",
    //     "link_to_species": "/tree/plantae/plantae.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample15",
    //     "images": [
    //         "U15_1.jpg",
    //     ],
    //     "species": "?cavoliniidae",
    //     "link_to_species": "/tree/animalia/mollusca/gastropoda/heterobranchia/cavoliniidae/cavoliniidae.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample16",
    //     "images": [
    //         "U16_1.jpg",
    //     ],
    //     "species": "?unclassified",
    //     "link_to_species": "/unclassified.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample2",
    //     "images": [
    //         "U2_1.jpg",
    //     ],
    //     "species": "?unclassified",
    //     "link_to_species": "/unclassified.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample17",
    //     "images": [
    //         "U17_1.jpg",
    //         "U17_2.jpg",
    //         "U17_3.jpg",
    //     ],
    //     "species": "?unclassified",
    //     "link_to_species": "/unclassified.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample18",
    //     "images": [
    //         "U18_1.jpg",
    //         "U18_2.jpg",
    //         "U18_3.jpg",
    //     ],
    //     "species": "?unclassified",
    //     "link_to_species": "/unclassified.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample19",
    //     "images": [
    //         "U19_1.jpg",
    //         "U19_2.jpg",
    //     ],
    //     "species": "?turritellidae",
    //     "link_to_species": "/tree/animalia/mollusca/gastropoda/caenogastropoda/turritellidae/turritellidae.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample20",
    //     "images": [
    //         "U20_1.jpg",
    //         "U20_2.jpg",
    //     ],
    //     "species": "?gastropoda",
    //     "link_to_species": "/tree/animalia/mollusca/gastropoda/gastropoda.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample21",
    //     "images": [
    //         "U21_1.jpg",
    //     ],
    //     "species": "?argonautidae",
    //     "link_to_species": "/tree/animalia/mollusca/cephalopoda/coleoidea/argonautidae/argonautidae.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample22",
    //     "images": [
    //         "U22_1.jpg",
    //         "U22_2.jpg",
    //     ],
    //     "species": "†Heterobrissus montesii",
    //     "link_to_species": "/tree/animalia/echinodermata/echinoidea/euechinoidea/spatangoida/heterobrissus/heterobrissus_montesii/heterobrissus_montesii.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample23",
    //     "images": [
    //         "U23_1.jpg",
    //         "U23_2.jpg",
    //         // παραλείπεται η 3 διότι δεν εικονίζει το δείγμα
    //         "U23_4.jpg",
    //         "U23_5.jpg",
    //     ],
    //     "species": "†Heterobrissus montesii",
    //     "link_to_species": "/tree/animalia/echinodermata/echinoidea/euechinoidea/spatangoida/heterobrissus/heterobrissus_montesii/heterobrissus_montesii.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample25",
    //     "images": [
    //         "U25_1.jpg",
    //         "U25_2.jpg",
    //     ],
    //     "species": "?chordata",
    //     "link_to_species": "/tree/animalia/chordata/chordata.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample26",
    //     "images": [
    //         "U26_1.jpg",
    //     ],
    //     "species": "?actinopterygii",
    //     "link_to_species": "/tree/animalia/chordata/osteichthyes/actinopterygii/actinopterygii.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample27",
    //     "images": [
    //         "U27_1.jpg",
    //     ],
    //     "species": "?chordata",
    //     "link_to_species": "/tree/animalia/chordata/chordata.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample28",
    //     "images": [
    //         "U28_1.jpg",
    //         "U28_2.jpg",
    //         "U28_3.jpg",
    //         "U28_4.jpg",
    //         "U28_5.jpg",
    //         "U28_6.jpg",
    //         "U28_7.jpg",
    //         "U28_8.jpg",
    //         "U28_9.jpg",
    //     ],
    //     "species": "?chordata",
    //     "link_to_species": "/tree/animalia/chordata/chordata.html",
    // },
    // {
    //     "image_path": "/images/cy_collection/sample29",
    //     "images": [
    //         "U29_1.jpg",
    //     ],
    //     "species": "?plantae",
    //     "link_to_species": "/tree/plantae/plantae.html",
    // }
    {
        "image_path": "/images/cy_collection/sample30",
        "images": [
            "U30_1.jpg",
        ],
        "species": "?venus",
        "link_to_species": "/tree/animalia/mollusca/bivalvia/autobranchia/veneridae/venus/venus.html",
    }
]



// Function to set the random sample
function setRandomSample() {
    // Get a random sample
    var sample = samples[Math.floor(Math.random() * samples.length)];
    // Get a random image from the sample
    var image = sample.images[Math.floor(Math.random() * sample.images.length)];
    // Set the image source
    var img = doc.getElementById('τυχαίο-δείγμα-εικόνα');
    img.src = getRelativePath(sample.image_path + '/' + image);
    // Set the image alt text
    img.alt = image;
    // Set the image title
    img.title = image;
    var title = doc.getElementById('τυχαίο-δείγμα-τίτλος');
    title.unprocessed_title = sample.species;
    // Set the image link
    var link = doc.getElementById('τυχαίο-δείγμα-σύνδεσμος');
    link.href = getRelativePath(sample.link_to_species);
  }
  
  // On page load, select and display a random sample
  window.addEventListener('DOMContentLoaded', () => {
    setRandomSample();
    });