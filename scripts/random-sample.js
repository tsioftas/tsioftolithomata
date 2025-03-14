var thisScript = document.currentScript;
var doc = document;

samples = [
    {
        "image_path": "/images/hypolophodon_sylvestris/sample1",
        "images": [
            "hypolophodon_sylvestris1_1.jpg",
            "hypolophodon_sylvestris1_2.jpg"
        ],
        "species": "†Hypolophodon sylvestris",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    },
    {
        "image_path": "/images/hypolophodon_sylvestris/sample2",
        "images": [
            "hypolophodon_sylvestris2_1.jpg",
            "hypolophodon_sylvestris2_2.jpg",
            "hypolophodon_sylvestris2_3.jpg"
        ],
        "species": "†Hypolophodon sylvestris",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    },
    {
        "image_path": "/images/hypolophodon_sylvestris/sample3",
        "images": [
            "hypolophodon_sylvestris3_1.jpg",
            "hypolophodon_sylvestris3_2.jpg",
            "hypolophodon_sylvestris3_3.jpg",
            "hypolophodon_sylvestris3_4.jpg"
        ],
        "species": "†Hypolophodon sylvestris",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    },
    {
        "image_path": "/images/hypolophodon_sylvestris/sample4",
        "images": [
            "hypolophodon_sylvestris4_1.jpg",
            "hypolophodon_sylvestris4_2.jpg"
        ],
        "species": "†Hypolophodon sylvestris",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    },
    {
        "image_path": "/images/hypolophodon_sylvestris/sample5",
        "images": [
            "hypolophodon_sylvestris5_1.jpg",
            "hypolophodon_sylvestris5_2.jpg",
            "hypolophodon_sylvestris5_3.jpg",
            "hypolophodon_sylvestris5_4.jpg"
        ],
        "species": "†Hypolophodon sylvestris",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    },
    {
        "image_path": "/images/hypolophodon_sylvestris/sample6",
        "images": [
            "hypolophodon_sylvestris6_1.jpg",
            "hypolophodon_sylvestris6_2.jpg",
            "hypolophodon_sylvestris6_3.jpg"
        ],
        "species": "†Hypolophodon sylvestris",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    },
    {
        "image_path": "/images/hypolophodon_sylvestris/sample7",
        "images": [
            "hypolophodon_sylvestris7_1.jpg",
            "hypolophodon_sylvestris7_2.jpg",
            "hypolophodon_sylvestris7_3.jpg",
            "hypolophodon_sylvestris7_4.jpg",
            "hypolophodon_sylvestris7_5.jpg"
        ],
        "species": "†Hypolophodon sylvestris",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    },
    {
        "image_path": "/images/hypolophodon_sylvestris/sample8",
        "images": [
            "hypolophodon_sylvestris8_1.jpg",
            "hypolophodon_sylvestris8_2.jpg",
            "hypolophodon_sylvestris8_3.jpg"
        ],
        "species": "†Hypolophodon sylvestris",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    },
    {
        "image_path": "/images/lepisosteus_suessionensis/sample1",
        "images": [
            "lepisosteus_suessionensis1_1.jpg",
            "lepisosteus_suessionensis1_2.jpg",
            "lepisosteus_suessionensis1_3.jpg"
        ],
        "species": "†Lepisosteus suessionensis",
        "link_to_species": "/tree/animalia/chordata/osteichthyes/actinopterygii/lepisosteidae/lepisosteus/lepisosteus_suessionensis/lepisosteus_suessionensis.html",
    },
    {
        "image_path": "/images/theodoxus_pisiformis/sample1",
        "images": [
            "theodoxus_pisiformis1_1.jpg",
            "theodoxus_pisiformis1_2.jpg",
            "theodoxus_pisiformis1_3.jpg"
        ],
        "species": "†Theodoxus pisiformis",
        "link_to_species": "/tree/animalia/mollusca/gastropoda/neritimorpha/neritidae/theodoxus/theodoxus_pisiformis/theodoxus_pisiformis.html",
    },
    {
        "image_path": "/images/theodoxus_pisiformis/sample2",
        "images": [
            "theodoxus_pisiformis2_1.jpg",
            "theodoxus_pisiformis2_2.jpg",
            "theodoxus_pisiformis2_3.jpg",
            "theodoxus_pisiformis2_4.jpg"
        ],
        "species": "†Theodoxus pisiformis",
        "link_to_species": "/tree/animalia/mollusca/gastropoda/neritimorpha/neritidae/theodoxus/theodoxus_pisiformis/theodoxus_pisiformis.html",
    },
    {
        "image_path": "/images/theodoxus_pisiformis/sample3",
        "images": [
            "theodoxus_pisiformis3_1.jpg",
            "theodoxus_pisiformis3_2.jpg",
            "theodoxus_pisiformis3_3.jpg",
            "theodoxus_pisiformis3_4.jpg"
        ],
        "species": "†Theodoxus pisiformis",
        "link_to_species": "/tree/animalia/mollusca/gastropoda/neritimorpha/neritidae/theodoxus/theodoxus_pisiformis/theodoxus_pisiformis.html",
    },
    {
        "image_path": "/images/lepisosteus_suessionensis/sample2",
        "images": [
            "lepisosteus_suessionensis2_1.jpg",
            "lepisosteus_suessionensis2_2.jpg",
            "lepisosteus_suessionensis2_3.jpg"
        ],
        "species": "†Lepisosteus suessionensis",
        "link_to_species": "/tree/animalia/chordata/osteichthyes/actinopterygii/lepisosteidae/lepisosteus/lepisosteus_suessionensis/lepisosteus_suessionensis.html",
    },
    {
        "image_path": "/images/lepisosteus_suessionensis/sample3",
        "images": [
            "lepisosteus_suessionensis3_1.jpg",
            "lepisosteus_suessionensis3_2.jpg",
            "lepisosteus_suessionensis3_3.jpg",
            "lepisosteus_suessionensis3_4.jpg"
        ],
        "species": "†Lepisosteus suessionensis",
        "link_to_species": "/tree/animalia/chordata/osteichthyes/actinopterygii/lepisosteidae/lepisosteus/lepisosteus_suessionensis/lepisosteus_suessionensis.html",
    },
    {
        "image_path": "/images/hypolophodon_sylvestris/sample9",
        "images": [
            "hypolophodon_sylvestris9_1.jpg",
            "hypolophodon_sylvestris9_2.jpg",
            "hypolophodon_sylvestris9_3.jpg",
            "hypolophodon_sylvestris9_4.jpg",
            "hypolophodon_sylvestris9_5.jpg"
        ],
        "species": "†Hypolophodon sylvestris",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/dasyatidae/hypolophodon/hypolophodon_sylvestris/hypolophodon_sylvestris.html",
    },
    {
        "image_path": "/images/theodoxus_pisiformis/sample4",
        "images": [
            "theodoxus_pisiformis4_1.jpg",
            "theodoxus_pisiformis4_2.jpg",
            "theodoxus_pisiformis4_3.jpg",
            "theodoxus_pisiformis4_4.jpg",
            "theodoxus_pisiformis4_5.jpg"
        ],
        "species": "†Theodoxus pisiformis",
        "link_to_species": "/tree/animalia/mollusca/gastropoda/neritimorpha/neritidae/theodoxus/theodoxus_pisiformis/theodoxus_pisiformis.html",
    },
    {
        "image_path": "/images/striatolamia_macrota/sample1",
        "images": [
            "striatolamia_macrota1_1.jpg",
            "striatolamia_macrota1_2.jpg",
            "striatolamia_macrota1_3.jpg",
            "striatolamia_macrota1_4.jpg"
        ],
        "species": "†Striatolamia macrota",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/odontaspididae/striatolamia/striatolamia_macrota/striatolamia_macrota.html",
    },
    {
        "image_path": "/images/striatolamia_macrota/sample2",
        "images": [
            "striatolamia_macrota2_1.jpg",
            "striatolamia_macrota2_2.jpg",
            "striatolamia_macrota2_3.jpg"
        ],
        "species": "†Striatolamia macrota",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/odontaspididae/striatolamia/striatolamia_macrota/striatolamia_macrota.html",
    },
    {
        "image_path": "/images/striatolamia_macrota/sample3",
        "images": [
            "striatolamia_macrota3_1.jpg",
            "striatolamia_macrota3_2.jpg",
            "striatolamia_macrota3_3.jpg",
            "striatolamia_macrota3_4.jpg",
            "striatolamia_macrota3_5.jpg"
        ],
        "species": "†Striatolamia macrota",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/odontaspididae/striatolamia/striatolamia_macrota/striatolamia_macrota.html",
    },
    {
        "image_path": "/images/sylvestrilamia_teretidens/sample1",
        "images": [
            "sylvestrilamia_teretidens1_1.jpg",
            "sylvestrilamia_teretidens1_2.jpg",
            "sylvestrilamia_teretidens1_3.jpg",
            "sylvestrilamia_teretidens1_4.jpg",
            "sylvestrilamia_teretidens1_5.jpg",
        ],
        "species": "†Sylvestrilamia teretidens",
        "link_to_species": "/tree/animalia/chordata/chondrichthyes/elasmobranchii/odontaspididae/sylvestrilamia/sylvestrilamia_teretidens/sylvestrilamia_teretidens.html",
    },
]



// Function to set the random sample
function setRandomSample() {
    // Get a random sample
    var sample = samples[Math.floor(Math.random() * samples.length)];
    // Get a random image from the sample
    var image = sample.images[Math.floor(Math.random() * sample.images.length)];
    // Set the image source
    var img = doc.getElementById('τυχαίο-δείγμα-εικόνα');
    img.src = "/tsioftolithomata" + sample.image_path + '/' + image;
    // Set the image alt text
    img.alt = image;
    // Set the image title
    img.title = image;
    var title = doc.getElementById('τυχαίο-δείγμα-τίτλος');
    title.textContent = sample.species;
    // Set the image link
    var link = doc.getElementById('τυχαίο-δείγμα-σύνδεσμος');
    link.href = "/tsioftolithomata" + sample.link_to_species;
  }
  
  // On page load, select and display a random sample
  window.addEventListener('DOMContentLoaded', () => {
    setRandomSample();
    });