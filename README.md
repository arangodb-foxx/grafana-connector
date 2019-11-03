# Grafana Simple JSON connector for ArangoDB

This is an example Grafana connector for ArangoDB that can be used with the
[Simple JSON Data Source plugin](https://grafana.com/plugins/grafana-simple-json-datasource/installation).

![SimpleJSON configuration dialog](./images/simplejson.png)

## Preparation

First install the Simple JSON Data Source plugin using the `grafana-cli`:

```sh
$ grafana-cli plugins install grafana-simple-json-datasource
```

You may have to restart Grafana for the new data source to become available.

## Installation

The Grafana connector can be installed as a Foxx service using the
[ArangoDB web interface](https://docs.arangodb.com/latest/Manual/Programs/WebInterface/Services.html)
or the [Foxx CLI](https://github.com/arangodb/foxx-cli):

```sh
$ npm install --global foxx-cli
$ foxx install -u root -P -H http://localhost:8529 -D _system /grafana \
https://github.com/arangodb-foxx/grafana-connector/archive/master.zip

# or without installing foxx-cli:

$ npx foxx-cli install -u root -P -H http://localhost:8529 -D _system /grafana \
https://github.com/arangodb-foxx/grafana-connector/archive/master.zip
```

## Configuration

Before you can use the ArangoDB connector in Grafana you need to configure the
service using the web interface or the Foxx CLI.

To configure the service in the ArangoDB web interface, open the service details
and then navigate to the _Settings_ tab in the top bar.

- **collections**: list of names of collections that will be exposed to Grafana,
  as a comma-separated list, e.g. `payments,timeouts` will expose the collections
  `payments` and `timeouts` in the database the service was installed.

- **aggregation** (default: `SUM`): name of the
  [AQL aggregation function](https://docs.arangodb.com/3.4/AQL/Operations/Collect.html#aggregation)
  that will be used to aggregate results for Grafana. Should be one of `SUM`,
  `AVG` (`AVERAGE`), `MIN` or `MAX`.

- **dateField** (default: `date`): name of the field on each document that will
  be used to find the documents relevant for each time range. The value of this
  field should be expressed in milliseconds since the start of the UNIX epoch.

- **valueField** (default: `value`): name of the field on each document that
  will be used to determine the value for that document. The value of this
  field must be numeric and may be aggregated when Grafana requests data for
  long time ranges.

- **username** and **password**: credentials that will be used by the Grafana
  data source to authenticate against this service.

  **Note**: These credentials will only be used by the Grafana data source and
  should **not** match the ArangoDB user credentials used to access ArangoDB
  itself.

![Foxx configuration dialog](./images/config.png)

## Adding the data source

To add the connector as a data source in Grafana, navigate to
_Configuration > Date Sources_ and press the _Add data source_ button,
then select the _SimpleJson_ data source.

Enter the URL of the service, e.g. http://localhost:8529/_db/_system/grafana,
and tick the checkbox for _Basic Auth_, then enter the credentials you defined
while configuring the service.

Press the button _Save & Test_ to create the data source and use it in your
dashboards.

**Note**: The collections exposed by the Grafana connector will appear in the
_select metric_ dropdown. The connector supports both the `timeserie` and
`table` modes of the Simple JSON Data Source. If you're not sure which mode
to use, you should probably use `timeserie`.

## License

This code is licensed under the
[Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).
