import { Addon, AddonInitialiser, Condition, UserInput, Variable, VariableCollection } from 'consequences/addons';

import { EventEmitter } from 'events';
import { Client, Error as HuejayError } from 'huejay';

export default class HueInitialiser implements AddonInitialiser {

  public readonly metadata: AddonInitialiser.Metadata = {
    name: 'Philips Hue',
    description: 'Provides support for the Philip Hue family of devices',
    supportsMultipleInstances: true,
    inputs: [
      {
        uniqueId: 'ip',
        name: 'Bridge IP Address',
        required: true,
        allowsMultiple: false,
        kind: 2, // UserInput.Kind.string
      },
      {
        uniqueId: 'username',
        name: 'Bridge Username',
        required: false,
        allowsMultiple: false,
        kind: 2, // UserInput.Kind.string
      },
    ],
  };

  public async createInstance(metadata: Addon.Metadata, saveData: (data: object) => void, savedData: HueAddon.SavedData = {}): Promise<HueAddon> {
    const ip = metadata.userProvidedInputs.find(input => input.uniqueId === 'ip');
    const userSuppliedUsername = metadata.userProvidedInputs.find(input => input.uniqueId === 'username');

    const username = (() => {
      if (userSuppliedUsername) {
        return userSuppliedUsername.value;
      } else {
        return savedData.username;
      }
    })();

    // TODO: Validated IP

    const client = new Client({
      host: ip.value,
      username,
    });

    try {
      await client.bridge.isAuthenticated();
      const user = await client.users.get();
    } catch (error) {
      if (userSuppliedUsername) {
        throw new Error(`Supplied username "${userSuppliedUsername} was not accepted.`);
      } else {
        if (savedData.username) {
          console.warn(`Saved username "${savedData.username} was not accepted.`);
        }

        const newUser = new client.users.User();
        newUser.deviceType = 'consequences-hue';

        try {
          const user = await client.users.create(newUser);

          saveData({
            username: user.username || user.attributes.attributes.username,
          });
        } catch (error) {
          if (error instanceof HuejayError && error.type === 101) {
            throw new Error(`Please press the link button on your hub.`);
          } else {
            throw error;
          }
        }
      }
    }

    return new HueAddon(metadata, client);
  }

}

class HueAddon implements Addon {

  public readonly metadata: Addon.Metadata;

  private client: Client;

  public get variables(): Promise<VariableCollection[]> {
    return new Promise(async (resolve) => {
      const lightsMetadata: LightMetadata[] = await this.client.lights.getAll();

      const lights = lightsMetadata.map((lightMetadata) => new LightBulb(this.client, lightMetadata));

      resolve(lights);
    });
  }

  constructor(metadata: Addon.Metadata, client: Client) {
    this.metadata = metadata;
    this.client = client;
  }

}

namespace HueAddon {
  export type SavedData = {
    username?: string;
  };
}

class LightBulb extends EventEmitter implements VariableCollection {

  private client: Client;
  private lightMetadata: LightMetadata;

  public get uniqueId(): string {
    return this.lightMetadata.uniqueId;
  }

  public get name(): string {
    return this.lightMetadata.model.name;
  }

  public variables: Variable[];

  constructor(client: Client, lightMetadata: LightMetadata) {
    super();

    this.client = client;
    this.lightMetadata = lightMetadata;
    this.variables = [
      new UpdatableObjectVariable('Brightness', lightMetadata, 'brightness', client.lights.save.bind(client.lights)),
    ];
  }

}

class ObjectVariable extends EventEmitter implements Variable {

  public get uniqueId(): string {
    return `${this.metadata.uniqueId}-${this.name}`;
  }

  private previousValue?: any;

  constructor(
    public name: string,
    protected metadata: ObjectMetadata,
    protected keyPath: string,
  ) {
    super();
  }

  public async retrieveValue(): Promise<any> {
    // TODO: Re-retrieve metadata (periodically?)
    const value = this.keyPath.split('.').reduce((previous: any, propertyName) => {
      return previous[propertyName];
    }, this.metadata);

    if (this.previousValue && this.previousValue !== value) {
      this.emit('valueChanged');
    }

    this.previousValue = value;

    return value;
  }

  public addChangeEventListener(listener: () => void): void {
    this.addListener('valueChanged', listener);
  }

  public removeChangeEventListener(listener: () => void): void {
    this.removeListener('valueChanged', listener);
  }

}

class UpdatableObjectVariable extends ObjectVariable {

  private saveMetadata: (metadata: ObjectMetadata) => Promise<void>;

  constructor(name: string, metadata: ObjectMetadata, keyPath: string, saveMetadata: (metadata: ObjectMetadata) => Promise<void>) {
    super(name, metadata, keyPath);

    this.saveMetadata = saveMetadata;
  }

  public async updateValue(newValue: any): Promise<void> {
    const splitKeyPath = this.keyPath.split('.');

    if (splitKeyPath.length === 1) {
      this.metadata[this.keyPath] = newValue;
    } else {
      splitKeyPath.reduce((previous: any, propertyName, index) => {
        if (index === splitKeyPath.length - 1) {
          previous[propertyName] = newValue;
        }
        return previous[propertyName];
      }, this.metadata);
    }

    this.saveMetadata(this.metadata);
  }

}

interface ObjectMetadata {
  readonly uniqueId: string;

  // Enable "type-safe" property lookup
  [index: string]: any;
}

interface LightMetadata extends ObjectMetadata {
  readonly id: number;
  name: string;
  readonly type: string;

  /**
   * Configurable brightness of the light (value from 0 to 254)
   */
  brightness: number;

  hue: number;

  saturation: number;

  readonly model: {
    readonly id: string;
    readonly name: string;
  };

  readonly state: {
    on: boolean;
    readonly reachable: boolean;

    /**
     * Configurable brightness of the light (value from 0 to 254)
     */
    brightness: number;
  };
}
