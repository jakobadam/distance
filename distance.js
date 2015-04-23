dojo.require('dojox.data.CsvStore');
dojo.require('dojo.data.ItemFileWriteStore');
dojo.require('dojox.grid.DataGrid');

dojo.require("dijit.form.TextBox");
dojo.require("dijit.form.Button");

if (window.File && window.FileReader && window.FileList && window.Blob) {
} 
else {
    alert('The File APIs are not fully supported in this browser. Try Google Chrome');
}

if(typeof WebKitBlobBuilder !== 'undefined'){
    BlobBuilder = WebKitBlobBuilder;
}
else if(typeof MozBlobBuilder !== 'undefined'){
    BlobBuilder = MozBlobBuilder;    
}
else{
    alert('You will not be able to download csv file since BlobBuilder is not supported by browser! Try Firefox or Chrome');
}

if(typeof window.URL === 'undefined'){
    if(typeof window.webkitURL !== 'undefined'){
        window.URL = window.webkitURL;
    }
    else{
        alert('You will not be able to download csv file since BlobBuilder is not fully supported by browser! Try Firefox or Chrome');
    }
}

CSV_SEPERATOR = '|';
// pid|delay|helikopter|omvisiteret|gade|nr|postnr|by|labelgroup

CSV_FIELDS = ['pid', 'duration', 'helicopter', 'rereferred', 'address_street', 'address_number', 'address_zip', 'city', 'group', 'distance', 'lat', 'lng', 'note'];

var store;
var service = new google.maps.DistanceMatrixService();
var geocoder = new google.maps.Geocoder();

// events
function onFileLoaded(text){}
function onFileParsed(store){}
function onGeocoded(store){}
function onDistance(store){}
function onCoordinates(item){}

function handleFileSelect(evt) {

    // FileList object
    var files = evt.target.files;
    var file = files[0];

    var reader = new FileReader();
    reader.onloadend = function(evt) {
      if (evt.target.readyState == FileReader.DONE) {
          onFileLoaded(evt.target.result);
      }
    };
    reader.readAsText(file);
}

function parseCsv(text){
    var lines = text.split('\n');
    // remove the meta line
    lines = lines.slice(1);
    dojo.forEach(lines, function(l){
        if(l === ''){
            return false;
        }
        var fields = l.split(CSV_SEPERATOR);
        var item = {};
        for(var i = 0; i < fields.length; i++){
            var field = fields[i];
            item[CSV_FIELDS[i]] = field;
        }
        item.note = "";
        store.newItem(item);
    });
    onFileParsed();
}

function getOrigin(item){
    return [store.getValue(item, 'address_street'), 
    store.getValue(item, 'address_number'), 
    store.getValue(item, 'address_zip'), 
    'danmark'].join(',');
}

function createGrid(){
    var grid = new dojox.grid.DataGrid({
        store: store,
        structure: [
            {
                width: '200px',
                formatter: function(val, rowIdx){
                    var item = this.grid.getItem(rowIdx);
                    console.log('item', item);
                    
                    return dojo.replace('{address_street}, {address_number}, {address_zip}', item);
                }
            },
            {
                field:'distance', 
                width:'90px',
                formatter: function(val){
                    return val / 1000 + ' km';
                }
            },
            {
                field: 'lat',
                width: '60px'
            },
            {
                field: 'lng',
                width: '60px'
            }
        ]
    }, 'grid');
    grid.startup();
}

function mapItem(item){
    var pos = new google.maps.LatLng(
        store.getValue(item, 'lat'), 
        store.getValue(item, 'lng'));
    var marker = new google.maps.Marker({
        map: map,
        position: pos
    });
    google.maps.event.addListener(marker, 'click', function() {
        console.log(getOrigin(item));
    });
}

function addCoordinates(item){

    console.log('adding coords', item);

    var lat = store.getValue(item, 'lat');
    var lng = store.getValue(item, 'lng');

    if(lat && lng){
        onCoordinates(item);
    }
    else{
        var query = getOrigin(item);

        geocoder.geocode({ 'address': query}, function(results, status) {
            if (status === google.maps.GeocoderStatus.OK) {
                console.log('got results', results);

                var geo_street = results[0].address_components[1].long_name.toLowerCase();
                var street = cleanAddress(store.getValue(item, 'address_street'));
                
                if(street !== geo_street){
                    var err = 'street mismatch!' + street + ' != ' + geo_street;
                    console.error(err);
                    store.setValue(item, 'note', err);
                    return;
                }

                var zip = cleanAddress(store.getValue(item, 'address_zip'));
                var geo_zip = results[0].address_components[results[0].address_components.length-1].long_name;
                
                if(zip !== geo_zip){
                    var err = 'zip mismatch!' + zip + ' != ' + geo_zip;
                    console.error(err);
                    store.setValue(item, 'note', err);
                    return;
                }

                var location = results[0].geometry.location;
                store.setValue(item, 'note', '');
                store.setValue(item, 'lat', location.lat());
                store.setValue(item, 'lng', location.lng());
                console.log('latlng', location.lat(), location.lng());
                onCoordinates(item);
            } 
            else if(status === 'OVER_QUERY_LIMIT'){
                setTimeout(function(){
                    addCoordinates(item);
                }, 500);
            }
            else {
                console.log("Geocode was not successful for the following reason: " + status);
            }
        });
    }
}

function cleanAddress(adr){
    return adr.toLowerCase();
}

function addDistance(item, dst){
    var distance = store.getValue(item, 'distance');
    var note = store.getValue(item, 'note');

    if(distance){
        return;
    }

    if(note){
        console.error('Something was wrong with the address, therefore skipping distance lookup');
        return;
    }
    
    var origin = getOrigin(item);

    function onDistance(response, status){
        if(status === 'OVER_QUERY_LIMIT'){
            setTimeout(function(){
                addDistance(item, dst);
            }, 500);
        }
        else if(status === 'NOT FOUND'){
            console.error('Could not find: ', item);
        }
        else{
            try{
                store.setValue(item, 'distance', response.rows[0].elements[0].distance.value);
            } catch (x) {
                console.error('response', response);
            }

        }
    }

    service.getDistanceMatrix({
        origins: [origin],
        destinations: [dst],
        travelMode: google.maps.TravelMode.DRIVING
    }, onDistance);
}

function addCoordinatesToAll() {
    
    store.fetch({
        onItem: function(item){
            addCoordinates(item);
        },
        onComplete: function(items){
            dojo.fadeIn({node:'results_wrapper'}).play();
        }});
}

function addDistanceToAll(){
    var dst = dojo.byId('dst').value;
    if(!dst){
        alert('Please supply a destination!');
        return;
    }

    store.fetch({
        onItem: function(item){
            addDistance(item, dst);
        }
    });
}

function getTemplate(){
    var t = "";
    dojo.forEach(CSV_FIELDS, function(field){
        t += '{' + field + '}|';
    });                          
    return t;
}

function convert2csv(items){
    var results = [];
    var meta_line = CSV_FIELDS.join('|');
    results.push(meta_line);
    dojo.forEach(items, function(item){
        var line = dojo.replace(getTemplate(), item);
        // remove all newlines
        line = line.replace('\n', '');
        results.push(line);
    });
    return results.join('\n');
}

function downloadResults(){
    store.fetch({
        sort: [{attribute: 'distance'}],
        onComplete: function(items){
            var csv = convert2csv(items);
            var bb = new BlobBuilder();
            bb.append(csv);
            var blobURL = window.URL.createObjectURL(bb.getBlob());
            window.location.href = blobURL;
        }            
    });
}

function showResults (text) {
    store.fetch({
        sort: [{attribute: 'distance'}],
        onComplete: function(items){
            var csv = convert2csv(items);
            dojo.byId('results_area').innerHTML = csv;
        }
    });
}

dojo.ready(
    function(){
        store = new dojo.data.ItemFileWriteStore({data:{items:[]}});

        var myOptions = {
            center: new google.maps.LatLng(56.2, 10.1),
            zoom: 10,
            mapTypeId: google.maps.MapTypeId.ROADMAP
        };
        map = new google.maps.Map(document.getElementById("map_canvas"), myOptions);

        var dst = new dijit.form.TextBox({
            value:"Skejby Sygehus, Brendstrupgårdsvej, Århus N, Denmark",
            style: 'width:100%'
        }, 'dst');

        createGrid();

        dojo.connect(dojo.byId('file'), 'change', handleFileSelect);

        dojo.connect('onFileLoaded', 'parseCsv');

        dojo.connect('onFileParsed', 'addCoordinatesToAll');

        dojo.connect('onCoordinates', 'addDistanceToAll');
        dojo.connect('onCoordinates', 'mapItem');

        dojo.connect(dojo.byId('download'), 'onclick', 'downloadResults');
        dojo.connect(dojo.byId('show'), 'onclick', 'showResults');
});
